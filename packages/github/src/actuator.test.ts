import { describe, expect, it } from "vitest";
import { LoggingReviewActuator, approvalGate, resolveDelivery } from "@pullup/core";
import { NOW, REPO, comment, fakeClient, planned, send, trustedStore } from "./harness.test-util.js";

describe("GitHubReviewActuator", () => {
  it("sends an act-level approval pinned to the planned commit, then verifies it", async () => {
    const f = fakeClient();
    const store = await trustedStore();
    const [rec] = await send(f.client, store, [planned({ action: "approve" })]);
    expect(f.fns()).toEqual(["getPull", "createReview", "listReviews"]);
    expect(f.calls[1]!.args).toMatchObject({ event: "APPROVE", commit_id: "sha2", pull_number: 7 });
    expect(rec!.status).toBe("sent");
    expect(rec!.delivery?.reviewId).toBe(100);
    expect(rec!.delivery?.verified?.ok).toBe(true);
    expect((await store.listReviewActions(REPO))[0]!.status).toBe("sent");
  });

  it("never re-sends the same (pull, head, action)", async () => {
    const f = fakeClient();
    const store = await trustedStore();
    await send(f.client, store, [planned({ action: "request_changes" })]);
    const [again] = await send(f.client, store, [planned({ action: "request_changes" })]);
    expect(f.fns().filter((x) => x === "createReview")).toHaveLength(1);
    expect(again!.status).toBe("sent");
  });

  it("a later logging run never overwrites a delivered record", async () => {
    const store = await trustedStore();
    await send(fakeClient().client, store, [planned({ action: "approve" })]);
    const [rec] = await new LoggingReviewActuator(store, () => NOW).apply([planned({ action: "approve" })]);
    expect(rec!.status).toBe("sent");
    expect((await store.listReviewActions(REPO)).map((r) => r.status)).toEqual(["sent"]);
  });

  it("skips when the head moved or the PR closed", async () => {
    const moved = fakeClient({ head: "sha3" });
    const [a] = await send(moved.client, await trustedStore(), [planned({ action: "approve" })]);
    expect(a!.status).toBe("skipped");
    expect(a!.delivery?.skipped).toMatch(/Head moved/);
    expect(moved.fns()).toEqual(["getPull"]);

    const closed = fakeClient({ state: "merged" });
    const [b] = await send(closed.client, await trustedStore(), [planned({ action: "approve" })]);
    expect(b!.status).toBe("skipped");
    expect(closed.fns()).toEqual(["getPull"]);
  });

  it("records `off` as suppressed without touching GitHub", async () => {
    const f = fakeClient();
    const [rec] = await send(f.client, await trustedStore(), [
      planned({ action: "approve", authority: "off", call: { createReview: null, upsertComment: null, requestReviewers: null } }),
    ]);
    expect(rec!.status).toBe("suppressed");
    expect(f.calls).toHaveLength(0);
  });

  it("creates the decision comment once, then edits it in place", async () => {
    const f = fakeClient();
    const store = await trustedStore();
    const commentOnly = (sha: string) =>
      planned({ action: "approve", headSha: sha, authority: "comment", call: { createReview: null, upsertComment: comment(sha), requestReviewers: null } });
    const [first] = await send(f.client, store, [commentOnly("sha2")]);
    expect(f.fns()).toEqual(["getPull", "findComment", "createComment", "findComment"]);
    expect(first!.delivery?.verified?.ok).toBe(true);
    const f2 = fakeClient({ head: "sha9" });
    const [second] = await send(f2.client, store, [commentOnly("sha9")]);
    expect(f2.fns()).toEqual(["getPull", "updateComment", "findComment"]);
    expect(second!.delivery?.commentId).toBe(first!.delivery?.commentId);
  });

  it("falls back to a new comment when the known one is gone", async () => {
    const f = fakeClient({ existingComment: 55, fail: { updateComment: 404 } });
    const [rec] = await send(f.client, await trustedStore(), [
      planned({ action: "defer_to_human", call: { createReview: null, upsertComment: comment(), requestReviewers: null } }),
    ]);
    expect(f.fns()).toEqual(["getPull", "findComment", "updateComment", "createComment", "findComment"]);
    expect(rec!.status).toBe("sent");
  });

  it("an act-level deferral comments and requests reviewers", async () => {
    const f = fakeClient();
    const [rec] = await send(f.client, await trustedStore(), [
      planned({
        action: "defer_to_human",
        call: {
          createReview: null,
          upsertComment: comment(),
          requestReviewers: { owner: "acme", repo: "api", pull_number: 7, reviewers: ["alice"] },
        },
      }),
    ]);
    expect(f.fns()).toEqual(["getPull", "findComment", "createComment", "requestReviewers", "findComment", "listRequestedReviewers"]);
    expect(rec!.delivery?.reviewersRequested).toEqual(["alice"]);
    expect(rec!.delivery?.verified?.detail).toMatch(/reviewers requested: alice/);
  });

  it("fails verification when a requested reviewer is not on the PR afterwards", async () => {
    const f = fakeClient({ unlistedReviewers: ["bob"] });
    const [rec] = await send(f.client, await trustedStore(), [
      planned({
        action: "defer_to_human",
        call: {
          createReview: null,
          upsertComment: comment(),
          requestReviewers: { owner: "acme", repo: "api", pull_number: 7, reviewers: ["alice", "bob"] },
        },
      }),
    ]);
    expect(rec!.status).toBe("failed");
    expect(rec!.delivery?.errors).toEqual(["verification: reviewer request for bob is not on the PR"]);
  });

  it("records partial failure and a retry only repeats what failed", async () => {
    const store = await trustedStore();
    const plan = planned({
      action: "defer_to_human",
      call: {
        createReview: null,
        upsertComment: comment(),
        requestReviewers: { owner: "acme", repo: "api", pull_number: 7, reviewers: ["alice"] },
      },
    });
    const bad = fakeClient({ fail: { requestReviewers: 422 } });
    const [rec] = await send(bad.client, store, [plan]);
    expect(rec!.status).toBe("failed");
    expect(rec!.delivery?.errors?.[0]).toMatch(/requestReviewers: 422/);
    expect(rec!.delivery?.commentId).toBeDefined();

    const good = fakeClient();
    const [retry] = await send(good.client, store, [plan]);
    expect(retry!.status).toBe("sent");
    expect(good.fns()).toEqual(["getPull", "updateComment", "requestReviewers", "findComment", "listRequestedReviewers"]);
  });

  it("dismisses its own stale REQUEST_CHANGES once the new head no longer warrants it", async () => {
    const store = await trustedStore();
    const first = fakeClient({ head: "sha1" });
    const [blocked] = await send(first.client, store, [planned({ action: "request_changes", headSha: "sha1" })]);
    const second = fakeClient({ head: "sha2" });
    const [approved] = await send(second.client, store, [planned({ action: "approve" })]);
    expect(second.fns()).toEqual(["getPull", "createReview", "dismissReview", "listReviews"]);
    expect(second.calls[2]!.args).toMatchObject({ review_id: blocked!.delivery!.reviewId });
    expect(approved!.delivery?.dismissedReviewIds).toEqual([blocked!.delivery!.reviewId]);

    // Never dismissed twice.
    const third = fakeClient({ head: "sha3" });
    await send(third.client, store, [planned({ action: "approve", headSha: "sha3" })]);
    expect(third.fns()).not.toContain("dismissReview");
  });
});

describe("approval gate", () => {
  const cal = (passed: boolean, repoId = REPO) =>
    ({ repoId, fastPathGate: { passed, checks: [] } }) as never;

  it("unlocks only with live delivery and a passing fast-path gate for this repo", () => {
    expect(approvalGate({ repoId: REPO, delivery: "live", calibration: cal(true) })).toEqual({ unlocked: true, reason: null });
    expect(approvalGate({ repoId: REPO, delivery: "log", calibration: cal(true) }).unlocked).toBe(false);
    expect(approvalGate({ repoId: REPO, delivery: "live", calibration: cal(false) }).reason).toMatch(/fast-path/);
    expect(approvalGate({ repoId: REPO, delivery: "live", calibration: cal(true, "other/repo") }).unlocked).toBe(false);
    expect(approvalGate({ repoId: REPO, delivery: "live", calibration: null }).reason).toMatch(/no calibration/);
  });

  it("delivery is live only when explicitly set", () => {
    expect(resolveDelivery({})).toBe("log");
    expect(resolveDelivery({ PULLUP_GITHUB_DELIVERY: "true" })).toBe("log");
    expect(resolveDelivery({ PULLUP_GITHUB_DELIVERY: "LIVE" })).toBe("live");
  });
});
