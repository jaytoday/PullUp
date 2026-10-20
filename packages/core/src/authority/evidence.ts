// Evidence (Agent Baseline OBS-02, OBS-05, OBS-06): an append-only record of
// every task, from plan to outcome. Each row stores the hash of the row before
// it in the same repo's chain, so editing or deleting a row is detectable by
// walking the chain (`verifyEvidenceChain`, `pullup evidence verify`).
//
// `review_actions` stays the mutable "latest state" table the dashboard lists;
// evidence is the history, and the evidence sheet is built only from it.

import { canonicalJson } from "../config/schema.js";
import { sha256 } from "../signals/hunks.js";
import type { PlannedReviewAction, ReviewActionRecord } from "../actions/review.js";
import type { PullStore } from "../schema/store.js";
import type { EvidenceKind, EvidenceRecord, NewEvidence } from "./records.js";

export function evidenceHash(rec: Omit<EvidenceRecord, "hash">): string {
  return sha256(
    canonicalJson({
      repoId: rec.repoId,
      seq: rec.seq,
      taskId: rec.taskId,
      agentVersion: rec.agentVersion,
      kind: rec.kind,
      at: rec.at,
      payload: rec.payload,
      prevHash: rec.prevHash,
    }),
  );
}

/** Appends one row to its repo's chain. Retries once if a concurrent writer took the sequence number. */
export async function appendEvidence(store: PullStore, entry: NewEvidence): Promise<EvidenceRecord> {
  for (let attempt = 0; ; attempt++) {
    const prev = await store.lastEvidence(entry.repoId);
    const unhashed = { ...entry, seq: (prev?.seq ?? 0) + 1, prevHash: prev?.hash ?? null };
    const rec: EvidenceRecord = { ...unhashed, hash: evidenceHash(unhashed) };
    try {
      await store.insertEvidence(rec);
      return rec;
    } catch (err) {
      if (attempt > 0) throw err;
    }
  }
}

export interface ChainBreak {
  readonly repoId: string;
  readonly seq: number;
  readonly problem: string;
}

/** Walks each repo's chain in order; reports every row whose hash or link does not hold. */
export function verifyEvidenceChain(records: readonly EvidenceRecord[]): { ok: boolean; checked: number; breaks: ChainBreak[] } {
  const byRepo = new Map<string, EvidenceRecord[]>();
  for (const r of records) byRepo.set(r.repoId, [...(byRepo.get(r.repoId) ?? []), r]);
  const breaks: ChainBreak[] = [];
  for (const [repoId, rows] of byRepo) {
    rows.sort((a, b) => a.seq - b.seq);
    let prev: EvidenceRecord | null = null;
    let expectedSeq = 1;
    for (const r of rows) {
      if (r.seq !== expectedSeq) breaks.push({ repoId, seq: r.seq, problem: `expected row ${expectedSeq} (a row is missing)` });
      if (r.prevHash !== (prev?.hash ?? null)) breaks.push({ repoId, seq: r.seq, problem: "link to the previous row does not match" });
      const { hash, ...rest } = r;
      if (evidenceHash(rest) !== hash) breaks.push({ repoId, seq: r.seq, problem: "row content does not match its hash (edited)" });
      prev = r;
      expectedSeq = r.seq + 1;
    }
  }
  return { ok: breaks.length === 0, checked: records.length, breaks };
}

/** The evidence rows the authorization step produces for one governed action. */
export function planEvidence(a: PlannedReviewAction, at: string): NewEvidence[] {
  if (!a.taskId || !a.task || !a.authorization) return [];
  const common = { repoId: a.repoId, taskId: a.taskId, agentVersion: a.task.agent.version, at };
  const auth = a.authorization;
  return [
    {
      ...common,
      kind: "planned",
      payload: {
        task: a.task,
        decision: { action: a.action, source: a.source, recommendation: a.recommendation, band: a.band, reason: a.reason },
        findings: (a.findings ?? []).map((f) => ({ level: f.level, title: f.title, source: f.source })),
        clamped: a.clamped ?? null,
      },
    },
    {
      ...common,
      kind: auth.decision === "deny" ? "denied" : "authorized",
      payload: {
        decision: auth.decision,
        reasons: auth.reasons,
        controls: auth.controls,
        profile: auth.profile,
        requested: auth.requested,
        effective: auth.effective,
        permissions: auth.permissions,
        credential: auth.credential,
        permit: a.permit ? { expiresAt: a.permit.claims.expiresAt, nonce: a.permit.claims.nonce } : null,
      },
    },
  ];
}

/** The final evidence row for what an actuator did with the action. */
export function outcomeEvidence(rec: ReviewActionRecord): NewEvidence | null {
  if (!rec.taskId || !rec.task) return null;
  const kind: EvidenceKind =
    rec.status === "sent"
      ? "sent"
      : rec.status === "logged" || rec.status === "suppressed"
        ? "logged"
        : rec.status === "skipped"
          ? "skipped"
          : rec.status === "denied"
            ? "denied"
            : "failed";
  return {
    repoId: rec.repoId,
    taskId: rec.taskId,
    agentVersion: rec.task.agent.version,
    at: rec.delivery?.at ?? rec.loggedAt,
    kind,
    payload: {
      status: rec.status,
      call: {
        event: rec.call.createReview?.event ?? null,
        commit: rec.call.createReview?.commit_id ?? null,
        comment: Boolean(rec.call.upsertComment),
        reviewers: rec.call.requestReviewers?.reviewers ?? [],
      },
      delivery: rec.delivery ?? null,
    },
  };
}

/** Removes what must never be stored or shown: the permit. */
export function withoutPermit<T extends PlannedReviewAction>(a: T): T {
  if (!a.permit) return a;
  const { permit: _permit, ...rest } = a;
  return rest as T;
}

export interface EvidenceSheet {
  readonly taskId: string;
  readonly repoId: string;
  readonly pullNumber: number | null;
  /** WHY · WHAT · RISK · AUTHORITY · ACTION · OUTCOME · VALIDATION · VERSION, built only from evidence rows. */
  readonly why: string | null;
  readonly what: { readonly action: string | null; readonly headSha: string | null; readonly source: string | null } | null;
  readonly risk: { readonly band: string | null; readonly findings: readonly unknown[]; readonly questionSet: string | null; readonly modelId: string | null } | null;
  readonly authority: Readonly<Record<string, unknown>> | null;
  readonly action: Readonly<Record<string, unknown>> | null;
  readonly outcome: { readonly kind: EvidenceKind; readonly status: string | null; readonly at: string } | null;
  readonly validation: Readonly<Record<string, unknown>> | null;
  readonly version: { readonly agentId: string | null; readonly agentVersion: string | null; readonly configVersion: number | null; readonly configHash: string | null } | null;
  readonly rows: readonly EvidenceRecord[];
}

/** Assembles the evidence sheet for one task. No narrative: every field is read from a row. */
export function evidenceSheet(taskId: string, rows: readonly EvidenceRecord[]): EvidenceSheet | null {
  const mine = rows.filter((r) => r.taskId === taskId).sort((a, b) => a.seq - b.seq);
  if (mine.length === 0) return null;
  const planned = mine.find((r) => r.kind === "planned")?.payload as
    | { task?: { pullNumber?: number; headSha?: string; agent?: { id?: string; version?: string }; config?: { version?: number | null; hash?: string }; risk?: { band?: string | null; questionSet?: string | null; modelId?: string | null } }; decision?: { action?: string; source?: string; reason?: string; band?: string | null }; findings?: unknown[] }
    | undefined;
  const auth = mine.find((r) => r.kind === "authorized" || (r.kind === "denied" && "decision" in r.payload));
  const credential = mine.find((r) => r.kind === "credential");
  const verified = mine.find((r) => r.kind === "verified");
  const revoked = mine.find((r) => r.kind === "revoked");
  const terminal = [...mine].reverse().find((r) => ["sent", "logged", "skipped", "failed"].includes(r.kind) || (r.kind === "denied" && "status" in r.payload));
  const task = planned?.task;
  return {
    taskId,
    repoId: mine[0]!.repoId,
    pullNumber: task?.pullNumber ?? null,
    why: planned?.decision?.reason ?? null,
    what: planned ? { action: planned.decision?.action ?? null, headSha: task?.headSha ?? null, source: planned.decision?.source ?? null } : null,
    risk: planned
      ? { band: planned.decision?.band ?? null, findings: planned.findings ?? [], questionSet: task?.risk?.questionSet ?? null, modelId: task?.risk?.modelId ?? null }
      : null,
    authority: auth ? { ...auth.payload, ...(credential ? { credentialMinted: credential.payload } : {}) } : null,
    action: terminal ? ((terminal.payload as { call?: Record<string, unknown> }).call ?? null) : null,
    outcome: terminal ? { kind: terminal.kind, status: ((terminal.payload as { status?: string }).status ?? null), at: terminal.at } : null,
    validation: verified || revoked ? { ...(verified ? { verification: verified.payload } : {}), ...(revoked ? { revocation: revoked.payload } : {}) } : null,
    version: task
      ? { agentId: task.agent?.id ?? null, agentVersion: task.agent?.version ?? null, configVersion: task.config?.version ?? null, configHash: task.config?.hash ?? null }
      : null,
    rows: mine,
  };
}
