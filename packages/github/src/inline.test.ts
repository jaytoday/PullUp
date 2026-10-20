// Inline finding comments through the live actuator (fake ReviewClient): post,
// keep across pushes, resolve only PullUp's own threads.

import { describe, expect, it } from "vitest";
import type { Finding, HunkRecord, PullDecision, PullStore } from "@pullup/core";
import { DEFAULT_INLINE, DEFAULT_SEVERITY, MODE_AUTHORITY, findingKey, findingMarker, planReviewActions } from "@pullup/core";
import { REPO, actuator, fakeClient, govern, trustedStore } from "./harness.test-util.js";

const hunks = (head: string): HunkRecord[] =>
  ["src/auth.ts", "src/b.ts"].map((path) => ({ repoId: REPO, pullNumber: 7, path, index: 0, header: "@@ -1,2 +1,4 @@", patch: "+x", noPatch: false, contentHash: `${path}@${head}` }));

const signal = (id: string, path: string): Finding => ({ id, level: "p0", source: "signal", kind: "signal", title: id, detail: "p=0.95", active: true, units: [`${path}#0`] });

const decision = (findings: Finding[]): PullDecision =>
  ({
    pullNumber: 7,
    title: "t",
    changeType: "feature",
    area: "core",
    author: "dev",
    state: "open",
    waitHours: 1,
    maxWaitHours: 4,
    delayCost: 0,
    expectedDefectCost: 0,
    marginalDelayPerHour: 0,
    marginalReviewBenefitPerHour: 0,
    lastReviewState: null,
    recommendation: "escalate",
    reason: "r",
    findings,
    risk: { mode: "active", escalateReasons: [] } as unknown as PullDecision["risk"],
    scope: { appliedRules: [], actions: DEFAULT_SEVERITY.actions, signalsCanRequestChanges: false, extraReviewers: [] },
    guardrails: { tier: "standard", lines: 10, files: 1, aiAuthored: false, requireHuman: [], approveBlockers: [], notes: [] },
  }) as PullDecision;

async function run(store: PullStore, client: ReturnType<typeof fakeClient>, findings: Finding[], head: string) {
  const planned = planReviewActions([decision(findings)], [{ number: 7, headSha: head }], {
    repoId: REPO,
    authority: MODE_AUTHORITY.full,
    inline: { ...DEFAULT_INLINE, enabled: true },
    hunks: hunks(head),
    findingComments: await store.listFindingComments(REPO, 7),
  });
  const [rec] = await actuator(client.client, store).apply(await govern(store, planned));
  return rec!;
}

describe("inline finding comments", () => {
  it("posts new comments as one COMMENT review, records them, and verifies the markers", async () => {
    const store = await trustedStore();
    const f = fakeClient({ head: "sha2" });
    const rec = await run(store, f, [signal("signal:touchesAuthz", "src/auth.ts")], "sha2");
    expect(rec.status).toBe("sent");
    expect(f.calls.find((c) => c.fn === "createInlineReview")!.args).toMatchObject({ event: "COMMENT", commit_id: "sha2" });
    expect(rec.delivery!.inline!.posted).toHaveLength(1);
    expect(rec.delivery!.verified!.detail).toContain("1 inline comment(s)");
    const rows = await store.listFindingComments(REPO, 7);
    expect(rows).toEqual([expect.objectContaining({ status: "open", path: "src/auth.ts", firstHeadSha: "sha2" })]);
  });

  it("keeps an open comment on the next push (no duplicate) and resolves it once the finding is gone", async () => {
    const store = await trustedStore();
    const first = fakeClient({ head: "sha2" });
    await run(store, first, [signal("signal:touchesAuthz", "src/auth.ts")], "sha2");

    // Same client state carries over between pushes: reuse its comments by re-planning on it.
    const second = first;
    const push = fakeClient({ head: "sha3" });
    Object.assign(push.client, { listReviewComments: second.client.listReviewComments, listReviewThreads: second.client.listReviewThreads, resolveReviewThread: second.client.resolveReviewThread });
    const kept = await run(store, push, [signal("signal:touchesAuthz", "src/auth.ts")], "sha3");
    expect(push.fns()).not.toContain("createInlineReview");
    expect((await store.listFindingComments(REPO, 7))[0]).toMatchObject({ status: "open", lastSeenHeadSha: "sha3" });
    expect(kept.status).toBe("sent");

    const fixed = fakeClient({ head: "sha4" });
    Object.assign(fixed.client, { listReviewComments: second.client.listReviewComments, listReviewThreads: second.client.listReviewThreads, resolveReviewThread: second.client.resolveReviewThread });
    const rec = await run(store, fixed, [], "sha4");
    expect(rec.delivery!.inline!.resolved).toEqual([findingKey("signal:touchesAuthz", "src/auth.ts")]);
    expect(fixed.calls.find((c) => c.fn === "replyToReviewComment")!.args.body).toContain("No longer flagged at `sha4`");
    expect(first.threads.every((t) => t.isResolved)).toBe(true);
    expect((await store.listFindingComments(REPO, 7))[0]).toMatchObject({ status: "resolved-by-pullup", resolvedHeadSha: "sha4" });
  });

  it("never posts over, or resolves, a comment someone else wrote with PullUp's marker", async () => {
    const store = await trustedStore();
    const f = fakeClient({ head: "sha2" });
    const key = findingKey("signal:touchesAuthz", "src/auth.ts");
    f.addForeignComment(`I agree ${findingMarker(key)}`);
    const rec = await run(store, f, [signal("signal:touchesAuthz", "src/auth.ts")], "sha2");
    expect(f.fns()).not.toContain("createInlineReview");
    expect(rec.delivery!.inline!.posted).toEqual([]);
    expect(await store.listFindingComments(REPO, 7)).toEqual([]);
    // Nothing recorded as PullUp's, so nothing is ever resolved.
    await run(store, fakeClient({ head: "sha3" }), [], "sha3");
    expect(f.threads.every((t) => !t.isResolved)).toBe(true);
  });

  it("a thread a human already resolved is recorded as such, and the finding isn't re-posted", async () => {
    const store = await trustedStore();
    const f = fakeClient({ head: "sha2" });
    await run(store, f, [signal("signal:touchesAuthz", "src/auth.ts")], "sha2");
    f.threads[0]!.isResolved = true;
    const next = fakeClient({ head: "sha3" });
    Object.assign(next.client, { listReviewThreads: f.client.listReviewThreads, listReviewComments: f.client.listReviewComments });
    const rec = await run(store, next, [], "sha3");
    expect(rec.delivery!.inline!.alreadyResolved).toHaveLength(1);
    expect(next.fns()).not.toContain("resolveReviewThread");
    expect((await store.listFindingComments(REPO, 7))[0]!.status).toBe("resolved-by-human");

    const back = fakeClient({ head: "sha4" });
    await run(store, back, [signal("signal:touchesAuthz", "src/auth.ts")], "sha4");
    expect(back.fns()).not.toContain("createInlineReview");
  });
});
