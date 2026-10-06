import { describe, expect, it } from "vitest";
import type { PlannedReviewAction } from "@pullup/core";
import { DECISION_COMMENT_MARKER, InMemoryStore, LoggingReviewActuator, approvalGate, resolveDelivery } from "@pullup/core";
import type { ReviewClient } from "./actuator.js";
import { GitHubReviewActuator } from "./actuator.js";

const NOW = "2026-09-24T12:00:00.000Z";
const REPO = "acme/api";

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(opts: { state?: string; head?: string; fail?: Partial<Record<string, number>>; existingComment?: number } = {}) {
  const calls: Call[] = [];
  let nextId = 100;
  const maybeFail = (fn: string) => {
    const status = opts.fail?.[fn];
    if (status) throw Object.assign(new Error(`${fn} failed`), { status });
  };
  const client: ReviewClient = {
    async getPull(args) {
      calls.push({ fn: "getPull", args });
      maybeFail("getPull");
      return { state: opts.state ?? "open", headSha: opts.head ?? "sha2" };
    },
    async createReview(args) {
      calls.push({ fn: "createReview", args });
      maybeFail("createReview");
      return { id: nextId++ };
    },
    async dismissReview(args) {
      calls.push({ fn: "dismissReview", args });
      maybeFail("dismissReview");
    },
    async findComment(args) {
      calls.push({ fn: "findComment", args });
      return opts.existingComment ?? null;
    },
    async createComment(args) {
      calls.push({ fn: "createComment", args });
      return { id: nextId++ };
    },
    async updateComment(args) {
      calls.push({ fn: "updateComment", args });
      maybeFail("updateComment");
      return { id: args.comment_id };
    },
    async requestReviewers(args) {
      calls.push({ fn: "requestReviewers", args });
      maybeFail("requestReviewers");
    },
  };
  return { client, calls, fns: () => calls.map((c) => c.fn) };
}

function planned(over: Partial<PlannedReviewAction> & Pick<PlannedReviewAction, "action">): PlannedReviewAction {
  const event = over.action === "approve" ? "APPROVE" : over.action === "request_changes" ? "REQUEST_CHANGES" : "COMMENT";
  const headSha = over.headSha ?? "sha2";
  return {
    repoId: REPO,
    pullNumber: 7,
    headSha,
    source: "tcm",
    recommendation: "auto-approve",
    band: null,
    reason: "r",
    authority: "act",
    call: {
      createReview:
        over.action === "defer_to_human"
          ? null
          : { owner: "acme", repo: "api", pull_number: 7, commit_id: headSha, event, body: "body" },
      upsertComment: null,
      requestReviewers: null,
    },
    ...over,
  };
}

const comment = (body = "c") => ({ owner: "acme", repo: "api", issue_number: 7, marker: DECISION_COMMENT_MARKER, body });

describe("GitHubReviewActuator", () => {
  it("sends an act-level approval pinned to the planned commit", async () => {
    const f = fakeClient();
    const store = new InMemoryStore();
    const [rec] = await new GitHubReviewActuator(f.client, store, () => NOW).apply([planned({ action: "approve" })]);
    expect(f.fns()).toEqual(["getPull", "createReview"]);
    expect(f.calls[1]!.args).toMatchObject({ event: "APPROVE", commit_id: "sha2", pull_number: 7 });
    expect(rec!.status).toBe("sent");
    expect(rec!.delivery?.reviewId).toBe(100);
    expect((await store.listReviewActions(REPO))[0]!.status).toBe("sent");
  });

  it("never re-sends the same (pull, head, action)", async () => {
    const f = fakeClient();
    const store = new InMemoryStore();
    const act = new GitHubReviewActuator(f.client, store, () => NOW);
    await act.apply([planned({ action: "request_changes" })]);
    const [again] = await act.apply([planned({ action: "request_changes" })]);
    expect(f.fns().filter((x) => x === "createReview")).toHaveLength(1);
    expect(again!.status).toBe("sent");
  });

  it("a later logging run never overwrites a delivered record", async () => {
    const store = new InMemoryStore();
    await new GitHubReviewActuator(fakeClient().client, store, () => NOW).apply([planned({ action: "approve" })]);
    const [rec] = await new LoggingReviewActuator(store, () => NOW).apply([planned({ action: "approve" })]);
    expect(rec!.status).toBe("sent");
    expect((await store.listReviewActions(REPO)).map((r) => r.status)).toEqual(["sent"]);
  });

  it("skips when the head moved or the PR closed", async () => {
    const moved = fakeClient({ head: "sha3" });
    const [a] = await new GitHubReviewActuator(moved.client, new InMemoryStore(), () => NOW).apply([planned({ action: "approve" })]);
    expect(a!.status).toBe("skipped");
    expect(a!.delivery?.skipped).toMatch(/Head moved/);
    expect(moved.fns()).toEqual(["getPull"]);

    const closed = fakeClient({ state: "merged" });
    const [b] = await new GitHubReviewActuator(closed.client, new InMemoryStore(), () => NOW).apply([planned({ action: "approve" })]);
    expect(b!.status).toBe("skipped");
    expect(closed.fns()).toEqual(["getPull"]);
  });

  it("records `off` as suppressed without touching GitHub", async () => {
    const f = fakeClient();
    const [rec] = await new GitHubReviewActuator(f.client, new InMemoryStore(), () => NOW).apply([
      planned({ action: "approve", authority: "off", call: { createReview: null, upsertComment: null, requestReviewers: null } }),
    ]);
    expect(rec!.status).toBe("suppressed");
    expect(f.calls).toHaveLength(0);
  });

  it("creates the decision comment once, then edits it in place", async () => {
    const f = fakeClient();
    const store = new InMemoryStore();
    const act = new GitHubReviewActuator(f.client, store, () => NOW);
    const commentOnly = (sha: string) =>
      planned({ action: "approve", headSha: sha, authority: "comment", call: { createReview: null, upsertComment: comment(sha), requestReviewers: null } });
    const [first] = await act.apply([commentOnly("sha2")]);
    expect(f.fns()).toEqual(["getPull", "findComment", "createComment"]);
    const f2 = fakeClient({ head: "sha9" });
    const [second] = await new GitHubReviewActuator(f2.client, store, () => NOW).apply([commentOnly("sha9")]);
    expect(f2.fns()).toEqual(["getPull", "updateComment"]);
    expect(second!.delivery?.commentId).toBe(first!.delivery?.commentId);
  });

  it("falls back to a new comment when the known one is gone", async () => {
    const f = fakeClient({ existingComment: 55, fail: { updateComment: 404 } });
    const [rec] = await new GitHubReviewActuator(f.client, new InMemoryStore(), () => NOW).apply([
      planned({ action: "defer_to_human", call: { createReview: null, upsertComment: comment(), requestReviewers: null } }),
    ]);
    expect(f.fns()).toEqual(["getPull", "findComment", "updateComment", "createComment"]);
    expect(rec!.status).toBe("sent");
  });

  it("an act-level deferral comments and requests reviewers", async () => {
    const f = fakeClient();
    const [rec] = await new GitHubReviewActuator(f.client, new InMemoryStore(), () => NOW).apply([
      planned({
        action: "defer_to_human",
        call: {
          createReview: null,
          upsertComment: comment(),
          requestReviewers: { owner: "acme", repo: "api", pull_number: 7, reviewers: ["alice"] },
        },
      }),
    ]);
    expect(f.fns()).toEqual(["getPull", "findComment", "createComment", "requestReviewers"]);
    expect(rec!.delivery?.reviewersRequested).toEqual(["alice"]);
  });

  it("records partial failure and a retry only repeats what failed", async () => {
    const store = new InMemoryStore();
    const plan = planned({
      action: "defer_to_human",
      call: {
        createReview: null,
        upsertComment: comment(),
        requestReviewers: { owner: "acme", repo: "api", pull_number: 7, reviewers: ["alice"] },
      },
    });
    const bad = fakeClient({ fail: { requestReviewers: 422 } });
    const [rec] = await new GitHubReviewActuator(bad.client, store, () => NOW).apply([plan]);
    expect(rec!.status).toBe("failed");
    expect(rec!.delivery?.errors?.[0]).toMatch(/requestReviewers: 422/);
    expect(rec!.delivery?.commentId).toBeDefined();

    const good = fakeClient();
    const [retry] = await new GitHubReviewActuator(good.client, store, () => NOW).apply([plan]);
    expect(retry!.status).toBe("sent");
    expect(good.fns()).toEqual(["getPull", "updateComment", "requestReviewers"]);
  });

  it("dismisses its own stale REQUEST_CHANGES once the new head no longer warrants it", async () => {
    const store = new InMemoryStore();
    const first = fakeClient({ head: "sha1" });
    const [blocked] = await new GitHubReviewActuator(first.client, store, () => NOW).apply([
      planned({ action: "request_changes", headSha: "sha1" }),
    ]);
    const second = fakeClient({ head: "sha2" });
    const [approved] = await new GitHubReviewActuator(second.client, store, () => NOW).apply([planned({ action: "approve" })]);
    expect(second.fns()).toEqual(["getPull", "createReview", "dismissReview"]);
    expect(second.calls[2]!.args).toMatchObject({ review_id: blocked!.delivery!.reviewId });
    expect(approved!.delivery?.dismissedReviewIds).toEqual([blocked!.delivery!.reviewId]);

    // Never dismissed twice.
    const third = fakeClient({ head: "sha3" });
    await new GitHubReviewActuator(third.client, store, () => NOW).apply([planned({ action: "approve", headSha: "sha3" })]);
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
