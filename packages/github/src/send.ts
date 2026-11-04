import { appendEvidence, checkPermit, type EvidenceStore, issuePermit, type NonceLedger } from "@pullup/engine";
import type { CheckRunCall, GitHubApi } from "./api";

/**
 * The governed sender: the only code that writes to GitHub. For each call:
 * stop switch → permit issued for this exact call → permit re-checked right
 * before acting (signature, expiry, call, single use) → the call → evidence.
 * Every step, including a refusal or a failed call, goes on the hash-chained
 * record. The only call is the "PullUp" check run; PullUp never merges,
 * changes branch protection or reverts.
 */

export interface SenderDeps {
  api: GitHubApi;
  /** Signs permits. Without it nothing is sent. */
  permitKey: string | null;
  ledger: NonceLedger;
  evidence: EvidenceStore;
  /** The stop switch: when it returns true, nothing is sent. */
  stopped: () => Promise<boolean>;
  now?: () => Date;
}

export type SendResult = { sent: true; checkRunId: number } | { sent: false; reason: string };

export async function sendCheckRun(deps: SenderDeps, runId: string, call: CheckRunCall): Promise<SendResult> {
  const now = deps.now ?? (() => new Date());
  const record = (kind: "permit-issued" | "sent" | "blocked", payload: unknown) =>
    appendEvidence(deps.evidence, { scope: call.repo, runId, kind, at: now().toISOString(), payload });
  const action = "check-run";

  if (await deps.stopped()) {
    await record("blocked", { action, reason: "the stop switch is on" });
    return { sent: false, reason: "the stop switch is on" };
  }
  if (!deps.permitKey) {
    await record("blocked", { action, reason: "no permit key is configured" });
    return { sent: false, reason: "no permit key is configured" };
  }
  const permit = issuePermit(call.repo, action, call, deps.permitKey, now());
  await record("permit-issued", { action, nonce: permit.claims.nonce, callHash: permit.claims.callHash, expiresAt: permit.claims.expiresAt });
  const problem = await checkPermit(permit, call, { key: deps.permitKey, now: now(), ledger: deps.ledger });
  if (problem) {
    await record("blocked", { action, reason: problem });
    return { sent: false, reason: problem };
  }
  try {
    const existing = await deps.api.findCheckRun(call.repo, call.headSha, call.name);
    const checkRunId = existing ? await deps.api.updateCheckRun(existing, call) : await deps.api.createCheckRun(call);
    await record("sent", { action, nonce: permit.claims.nonce, checkRunId, updated: existing !== null, status: call.status, conclusion: call.conclusion, title: call.title });
    return { sent: true, checkRunId };
  } catch (err) {
    const reason = `GitHub refused the call: ${(err as Error).message}`;
    await record("blocked", { action, nonce: permit.claims.nonce, reason });
    return { sent: false, reason };
  }
}
