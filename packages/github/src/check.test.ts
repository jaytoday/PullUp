// The PullUp check run through the live actuator (fake ReviewClient, never the network).

import { describe, expect, it } from "vitest";
import type { PullDecision } from "@pullup/core";
import { DEFAULT_CHECKS, MODE_AUTHORITY, planReviewActions } from "@pullup/core";
import { REPO, actuator, fakeClient, govern, trustedStore } from "./harness.test-util.js";

const decision = (over: Partial<PullDecision>): PullDecision =>
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
    recommendation: "request-changes",
    reason: "Net value is negative.",
    ...over,
  }) as PullDecision;

const plan = (d: PullDecision, blockOn: "never" | "request-changes" = "request-changes", headSha = "sha2") =>
  planReviewActions([d], [{ number: 7, headSha }], {
    repoId: REPO,
    authority: MODE_AUTHORITY.full,
    approvalUnlocked: true,
    checks: { ...DEFAULT_CHECKS, enabled: true, blockOn },
  });

describe("check run delivery", () => {
  it("creates the check on the planned head with checks: write, and verifies its conclusion", async () => {
    const store = await trustedStore();
    const f = fakeClient();
    const minted: unknown[] = [];
    const governed = await govern(store, plan(decision({})));
    expect(governed[0]!.authorization!.permissions).toMatchObject({ checks: "write", pull_requests: "write" });
    const [rec] = await actuator(f.client, store, { onMint: (_r, p) => minted.push(p) }).apply(governed);
    expect(rec!.status).toBe("sent");
    expect(minted[0]).toMatchObject({ checks: "write" });
    const created = f.calls.find((c) => c.fn === "createCheckRun")!.args;
    expect(created).toMatchObject({ name: "PullUp", head_sha: "sha2", conclusion: "failure", status: "completed" });
    expect(rec!.delivery!.checkRunId).toBeTypeOf("number");
    expect(rec!.delivery!.verified!.detail).toContain("check");
    expect(f.fns()).toContain("getCheckRun");
  });

  it("updates an existing PullUp check on the same head instead of adding a second one", async () => {
    const store = await trustedStore();
    const f = fakeClient();
    await actuator(f.client, store).apply(await govern(store, plan(decision({}))));
    // Same head, a different action later (a human asked for review → now asks a human).
    await actuator(f.client, store).apply(await govern(store, plan(decision({ recommendation: "escalate" }))));
    expect(f.fns().filter((x) => x === "createCheckRun")).toHaveLength(1);
    expect(f.fns().filter((x) => x === "updateCheckRun")).toHaveLength(1);
    expect([...f.checkRuns.values()]).toEqual([expect.objectContaining({ conclusion: "neutral" })]);
  });

  it("a failed check marks the action failed, and a retry repeats only the check", async () => {
    const store = await trustedStore();
    const broken = fakeClient({ fail: { createCheckRun: 502 } });
    const [first] = await actuator(broken.client, store).apply(await govern(store, plan(decision({}))));
    expect(first!.status).toBe("failed");
    expect(first!.delivery!.errors!.join()).toContain("checks");
    expect(first!.delivery!.reviewId).toBeTypeOf("number");

    const ok = fakeClient();
    const [second] = await actuator(ok.client, store).apply(await govern(store, plan(decision({}))));
    expect(second!.status).toBe("sent");
    expect(ok.fns()).not.toContain("createReview");
    expect(ok.fns()).toContain("createCheckRun");
  });

  it("a moved head sends nothing, check included", async () => {
    const store = await trustedStore();
    const f = fakeClient({ head: "sha3" });
    const [rec] = await actuator(f.client, store).apply(await govern(store, plan(decision({}))));
    expect(rec!.status).toBe("skipped");
    expect(f.fns().some((x) => x.includes("CheckRun"))).toBe(false);
  });

  it("a personal token can't post check runs: the check is skipped with a reason, and the comment still sends", async () => {
    const store = await trustedStore();
    const f = fakeClient();
    const governed = await govern(store, plan(decision({})), { credential: "standing-token" });
    expect(governed[0]!.authorization!.effective).toBe("comment");
    expect(governed[0]!.call.checkRun).toBeNull();
    expect(governed[0]!.authorization!.reasons.join(" ")).toMatch(/Check runs need a GitHub App/);
    const [rec] = await actuator(f.client, store, { kind: "standing-token" }).apply(governed);
    expect(rec!.status).toBe("sent");
    expect(f.fns().some((x) => x.includes("CheckRun"))).toBe(false);
  });
});
