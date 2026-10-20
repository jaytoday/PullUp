// Agent Baseline conformance suite (docs/authority.md). The proposal's
// scenarios, offline: a fake ReviewClient and a fake credential broker, never
// the network. Each test names the control it evidences.

import { describe, expect, it } from "vitest";
import type { PlannedReviewAction, PullDecision } from "@pullup/core";
import {
  InMemoryStore,
  LoggingReviewActuator,
  MODE_AUTHORITY,
  evidenceSheet,
  findAgents,
  governPlan,
  impactOf,
  planReviewActions,
  setAgentStatus,
  stopPullUp,
  verifyEvidenceChain,
  enrollRepo,
} from "@pullup/core";
import { AGENT, NOW, REPO, actuator, fakeClient, govern, trustedStore } from "./harness.test-util.js";

const decision = (over: Partial<PullDecision>): PullDecision =>
  ({
    pullNumber: 7,
    title: "t",
    changeType: "chore",
    area: "app",
    author: "dev",
    state: "open",
    waitHours: 1,
    maxWaitHours: 4,
    delayCost: 0,
    expectedDefectCost: 0,
    marginalDelayPerHour: 0,
    marginalReviewBenefitPerHour: 0,
    lastReviewState: null,
    recommendation: "auto-approve",
    reason: "Low risk: waiting costs more than a review would save.",
    ...over,
  }) as PullDecision;

/** planReviewActions exactly as the surfaces call it, in Full mode with approval unlocked. */
const plan = (d: PullDecision, approvalUnlocked = true) =>
  planReviewActions([d], [{ number: 7, headSha: "sha2" }], { repoId: REPO, authority: MODE_AUTHORITY.full, approvalUnlocked });

const later = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

describe("Agent Baseline conformance", () => {
  it("AUT-02 · AUT-04 · VAL-04 — low risk, enrolled, gate passed, live: approve sent on a repo-scoped token, revoked, verified", async () => {
    const store = await trustedStore();
    const minted: Array<{ repo: string; perms: unknown }> = [];
    let revoked = 0;
    const f = fakeClient();
    const governed = await govern(store, plan(decision({})));
    expect(governed[0]!.authorization).toMatchObject({ decision: "allow", effective: "act", profile: "review" });
    const [rec] = await actuator(f.client, store, { onMint: (repo, perms) => minted.push({ repo, perms }), onRevoke: () => revoked++ }).apply(governed);

    expect(rec!.status).toBe("sent");
    expect(f.calls.find((c) => c.fn === "createReview")!.args).toMatchObject({ event: "APPROVE", commit_id: "sha2" });
    expect(minted).toEqual([{ repo: REPO, perms: { pull_requests: "write" } }]);
    expect(revoked).toBe(1);
    expect(rec!.delivery?.credential).toMatchObject({ kind: "app", repositories: [REPO], revoked: true });
    expect(rec!.delivery?.verified).toMatchObject({ ok: true });
    // The permit is never persisted.
    expect((await store.listReviewActions(REPO))[0]).not.toHaveProperty("permit");
  });

  it("decision, not authority — high risk with full authority still never approves", async () => {
    const store = await trustedStore();
    const d = decision({
      recommendation: "escalate",
      risk: { mode: "active", escalateReasons: ["touches auth"], reviewReasons: [], band: "escalate" } as never,
    });
    const [a] = await govern(store, plan(d));
    expect(a!.action).toBe("defer_to_human");
    expect(a!.call.createReview).toBeNull();
  });

  it("CON-04 — approve on a repo enrolled in review-block-only becomes comment only, with comment-only permissions", async () => {
    const store = await trustedStore();
    await enrollRepo(store, { repoId: REPO, profile: "review-block-only", by: "test", now: NOW });
    const minted: unknown[] = [];
    const f = fakeClient();
    const governed = await govern(store, plan(decision({})));
    expect(governed[0]!.authorization).toMatchObject({ decision: "allow-comment-only", requested: "act", effective: "comment" });
    expect(governed[0]!.call.createReview).toBeNull();
    expect(governed[0]!.call.upsertComment?.body).toMatch(/PullUp would approve/);
    const [rec] = await actuator(f.client, store, { onMint: (_r, p) => minted.push(p) }).apply(governed);
    expect(rec!.status).toBe("sent");
    expect(f.fns()).not.toContain("createReview");
    expect(minted).toEqual([{ pull_requests: "read", issues: "write" }]);
  });

  it("CON-04 — a repo that was never enrolled is observe-only", async () => {
    const store = new InMemoryStore();
    const [a] = await govern(store, plan(decision({ recommendation: "request-changes" })));
    expect(a!.authorization).toMatchObject({ profile: "observe", decision: "allow-comment-only", effective: "comment" });
  });

  it("AUT-02 — an expired permit is denied before any GitHub call", async () => {
    const store = await trustedStore();
    const f = fakeClient();
    const [rec] = await actuator(f.client, store, { now: later(6) }).apply(await govern(store, plan(decision({}))));
    expect(rec!.status).toBe("denied");
    expect(rec!.delivery?.denied?.[0]).toMatch(/expired/);
    expect(f.calls).toHaveLength(0);
  });

  it("AUT-06 — a new commit between plan and send is skipped", async () => {
    const store = await trustedStore();
    const f = fakeClient({ head: "sha3" });
    const [rec] = await actuator(f.client, store).apply(await govern(store, plan(decision({}))));
    expect(rec!.status).toBe("skipped");
    expect(f.fns()).toEqual(["getPull"]);
  });

  it("AUT-02 — a config saved between plan and send voids the permit", async () => {
    const store = await trustedStore();
    const f = fakeClient();
    const [rec] = await actuator(f.client, store, { configHash: "cfg-hash-2" }).apply(await govern(store, plan(decision({}))));
    expect(rec!.status).toBe("denied");
    expect(rec!.delivery?.denied).toContain("The repo's config changed after this action was authorized.");
    expect(f.calls).toHaveLength(0);
  });

  it("RES-02 — quarantining the agent version denies its outstanding permits and every new one", async () => {
    const store = await trustedStore();
    const outstanding = await govern(store, plan(decision({})));
    const [agent] = await findAgents(store, AGENT.version);
    await setAgentStatus(store, { agent: agent!, status: "quarantined", by: "test", now: NOW });
    const f = fakeClient();
    const [rec] = await actuator(f.client, store).apply(outstanding);
    expect(rec!.status).toBe("denied");
    expect(rec!.delivery?.denied).toContain("This agent version was quarantined.");
    expect(f.calls).toHaveLength(0);
    const [fresh] = await govern(store, plan(decision({})));
    expect(fresh!.authorization).toMatchObject({ decision: "deny", controls: ["RES-02"] });
    expect(fresh!.permit).toBeUndefined();
  });

  it("RES-01 — the stop switch, turned on after a permit was issued, denies before any GitHub call", async () => {
    const store = await trustedStore();
    const governed = await govern(store, plan(decision({})));
    await stopPullUp(store, { reason: "incident", by: "dashboard", now: NOW });
    const f = fakeClient();
    const [rec] = await actuator(f.client, store).apply(governed);
    expect(rec!.status).toBe("denied");
    expect(rec!.delivery?.denied?.[0]).toMatch(/stopped everywhere by dashboard \(incident\)/);
    expect(f.calls).toHaveLength(0);
  });

  it("RES-01 — a repo-scoped stop denies that repo only", async () => {
    const store = await trustedStore();
    await stopPullUp(store, { scope: "other/repo", by: "cli", now: NOW });
    const [a] = await govern(store, plan(decision({})));
    expect(a!.authorization?.decision).toBe("allow");
    await stopPullUp(store, { scope: REPO, by: "cli", now: NOW });
    const [b] = await govern(store, plan(decision({})));
    expect(b!.authorization?.decision).toBe("deny");
  });

  it("AUT-06 — live delivery without PULLUP_PERMIT_KEY denies every send", async () => {
    const store = await trustedStore();
    const [a] = await govern(store, plan(decision({})), { permitKey: null });
    expect(a!.authorization).toMatchObject({ decision: "deny" });
    expect(a!.authorization!.reasons[0]).toMatch(/PULLUP_PERMIT_KEY/);
    const f = fakeClient();
    const [rec] = await actuator(f.client, store).apply([a!]);
    expect(rec!.status).toBe("denied");
    expect(f.calls).toHaveLength(0);
  });

  it("AUT-02 — a forged or altered permit is denied", async () => {
    const store = await trustedStore();
    const [a] = await govern(store, plan(decision({}), false));
    // Approval was locked (comment); someone edits the permit up to act.
    const forged: PlannedReviewAction = { ...a!, permit: { ...a!.permit!, claims: { ...a!.permit!.claims, level: "act" } } };
    const f = fakeClient();
    const [rec] = await actuator(f.client, store).apply([forged]);
    expect(rec!.status).toBe("denied");
    expect(rec!.delivery?.denied?.[0]).toMatch(/signature is invalid/);

    // Or keeps the permit but swaps the call for an approval.
    const [b] = await govern(store, plan(decision({}), false));
    const swapped: PlannedReviewAction = {
      ...b!,
      call: { createReview: { owner: "acme", repo: "api", pull_number: 7, commit_id: "sha2", event: "APPROVE", body: "x" }, upsertComment: null, requestReviewers: null },
    };
    const [rec2] = await actuator(f.client, store).apply([swapped]);
    expect(rec2!.status).toBe("denied");
    expect(rec2!.delivery?.denied?.join(" ")).toMatch(/GitHub call/);
    expect(f.calls).toHaveLength(0);
  });

  it("AUT-02 — a permit is single use", async () => {
    const store = await trustedStore();
    const governed = await govern(store, plan(decision({})));
    await actuator(fakeClient({ head: "sha3" }).client, store).apply(governed); // consumed, skipped
    const f = fakeClient();
    const [rec] = await actuator(f.client, store).apply(governed);
    expect(rec!.status).toBe("denied");
    expect(rec!.delivery?.denied).toEqual(["Permit was already used."]);
    expect(f.calls).toHaveLength(0);
  });

  it("RES-01 — a stop never erases what already landed, so resuming never re-sends it", async () => {
    const store = await trustedStore();
    const d = decision({ recommendation: "request-changes" });
    const f = fakeClient();
    const [sent] = await actuator(f.client, store).apply(await govern(store, plan(d)));
    expect(sent!.status).toBe("sent");
    await stopPullUp(store, { by: "cli", now: NOW });
    const [again] = await actuator(f.client, store).apply(await govern(store, plan(d)));
    expect(again!.status).toBe("sent"); // the delivered record is returned untouched
    expect((await store.listReviewActions(REPO))[0]!.status).toBe("sent");
    expect(f.fns().filter((x) => x === "createReview")).toHaveLength(1);
  });

  it("VAL-04 — a review that does not read back as sent is recorded failed", async () => {
    const store = await trustedStore();
    const f = fakeClient();
    f.client.listReviews = async () => [{ id: 100, state: "COMMENTED", commitId: "sha2" }];
    const [rec] = await actuator(f.client, store).apply(await govern(store, plan(decision({}))));
    expect(rec!.status).toBe("failed");
    expect(rec!.delivery?.errors?.[0]).toMatch(/verification: review 100 is COMMENTED, expected APPROVED/);
    expect(rec!.delivery?.credential?.revoked).toBe(true);
  });

  it("AUT-04 — a personal token may only comment (Q2)", async () => {
    const store = await trustedStore();
    const [a] = await govern(store, plan(decision({ recommendation: "request-changes" })), { credential: "standing-token" });
    expect(a!.authorization).toMatchObject({ decision: "allow-comment-only", effective: "comment", credential: "standing-token" });
    expect(a!.authorization!.controls).toContain("AUT-04");
  });

  it("DIS-01 — a new agent version may only comment until approved (Q4), and cannot act at execution either", async () => {
    const store = new InMemoryStore();
    await enrollRepo(store, { repoId: REPO, profile: "review", by: "test", now: NOW });
    const [a] = await govern(store, plan(decision({ recommendation: "request-changes" })));
    expect(a!.authorization).toMatchObject({ decision: "allow-comment-only", effective: "comment", controls: expect.arrayContaining(["DIS-01"]) });

    // A permit issued while approved is refused at execution once approval is withdrawn.
    const trusted = await trustedStore();
    const governed = await govern(trusted, plan(decision({ recommendation: "request-changes" })));
    const [agent] = await findAgents(trusted, AGENT.version);
    await setAgentStatus(trusted, { agent: agent!, status: "pending", by: "test", now: NOW });
    const [rec] = await actuator(fakeClient().client, trusted).apply(governed);
    expect(rec!.delivery?.denied).toContain("This agent version is not approved to act.");
  });

  it("OBS-05 · OBS-06 — every step is evidence; editing a row breaks the chain", async () => {
    const store = await trustedStore();
    const [rec] = await actuator(fakeClient().client, store).apply(await govern(store, plan(decision({}))));
    const rows = await store.listEvidence({ taskId: rec!.taskId });
    expect(rows.map((r) => r.kind)).toEqual(["planned", "authorized", "credential", "verified", "revoked", "sent"]);
    const sheet = evidenceSheet(rec!.taskId!, rows)!;
    expect(sheet.why).toMatch(/Low risk/);
    expect(sheet.authority).toMatchObject({ decision: "allow", effective: "act" });
    expect(sheet.outcome).toMatchObject({ kind: "sent", status: "sent" });
    expect(sheet.validation).toHaveProperty("verification");
    expect(sheet.version).toMatchObject({ agentId: AGENT.id, agentVersion: AGENT.version });
    expect(verifyEvidenceChain(await store.listEvidence()).ok).toBe(true);

    store.tamperEvidence((all) => all.map((r) => (r.kind === "authorized" ? { ...r, payload: { ...r.payload, effective: "comment" } } : r)));
    const check = verifyEvidenceChain(await store.listEvidence());
    expect(check.ok).toBe(false);
    expect(check.breaks[0]!.problem).toMatch(/edited/);

    store.tamperEvidence((all) => all.filter((r) => r.kind !== "credential"));
    expect(verifyEvidenceChain(await store.listEvidence()).breaks.some((b) => /missing/.test(b.problem))).toBe(true);
  });

  it("RES-03 — impact lists every task an agent version ran and what it touched", async () => {
    const store = await trustedStore();
    const [rec] = await actuator(fakeClient().client, store).apply(await govern(store, plan(decision({}))));
    const impact = impactOf(await store.listEvidence({ agentVersion: AGENT.version }));
    expect(impact).toEqual([
      expect.objectContaining({ taskId: rec!.taskId, repoId: REPO, pullNumber: 7, action: "approve", outcome: "sent", github: { reviewId: 100 } }),
    ]);
  });

  it("invariant — logging mode: the plan is unchanged, no permit is issued and nothing reaches GitHub", async () => {
    const store = await trustedStore();
    const planned = plan(decision({ recommendation: "request-changes" }));
    const before = JSON.stringify(planned);
    const governed = await governPlan(store, planned, {
      repoId: REPO,
      initiator: { kind: "cli", ref: null },
      agent: AGENT,
      config: { version: null, hash: "h" },
      delivery: "log",
      credential: null,
      permitKey: "k",
      sign: true,
      now: NOW,
    });
    expect(JSON.stringify(planned)).toBe(before);
    expect(governed[0]!.permit).toBeUndefined();
    expect(governed[0]!.call.createReview).toEqual(planned[0]!.call.createReview);
    const [rec] = await new LoggingReviewActuator(store, () => NOW).apply(governed);
    expect(rec!.status).toBe("logged");
    expect(rec!.authorization?.decision).toBe("allow");
  });
});
