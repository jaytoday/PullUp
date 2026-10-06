// The live review actuator: sends planned review actions to GitHub.
//
// Per planned action, in order:
//   1. guard   — skip if the PR is closed or its head moved past the planned
//                sha (the next webhook re-plans), or if this exact
//                (pull, head, action) was already delivered;
//   2. comment — upsert PullUp's single decision comment (edited in place);
//   3. review  — pulls.createReview (APPROVE / REQUEST_CHANGES), pinned to the
//                planned commit so an approval never covers newer code;
//   4. reviewers — pulls.requestReviewers for an `act`-level deferral;
//   5. dismiss — PullUp's own earlier REQUEST_CHANGES on an older head, once
//                the current head no longer warrants one (so the bot never
//                leaves a stale block behind).
//
// A partly failed action is recorded `failed` with what did succeed, so a
// retry never repeats a review that already landed. It never plans anything:
// what to send is decided by @pullup/core (planReviewActions + authority).

import type { Octokit } from "@octokit/rest";
import type {
  DeliveryMode,
  PlannedReviewAction,
  PullStore,
  ReviewActionRecord,
  ReviewActuator,
  ReviewDelivery,
} from "@pullup/core";
import { LoggingReviewActuator, deliveredRecord } from "@pullup/core";
import type { GitHubEnv } from "./auth.js";
import { createRepoOctokit } from "./auth.js";

/** The GitHub calls the actuator needs — narrow so tests can fake it. */
export interface ReviewClient {
  getPull(p: { owner: string; repo: string; pull_number: number }): Promise<{ state: string; headSha: string }>;
  createReview(p: {
    owner: string;
    repo: string;
    pull_number: number;
    commit_id: string;
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    body: string;
  }): Promise<{ id: number }>;
  dismissReview(p: { owner: string; repo: string; pull_number: number; review_id: number; message: string }): Promise<void>;
  /** Newest issue comment containing `marker`, or null. */
  findComment(p: { owner: string; repo: string; issue_number: number; marker: string }): Promise<number | null>;
  createComment(p: { owner: string; repo: string; issue_number: number; body: string }): Promise<{ id: number }>;
  updateComment(p: { owner: string; repo: string; comment_id: number; body: string }): Promise<{ id: number }>;
  requestReviewers(p: { owner: string; repo: string; pull_number: number; reviewers: string[] }): Promise<void>;
}

export function octokitReviewClient(octokit: Octokit): ReviewClient {
  return {
    async getPull(p) {
      const { data } = await octokit.rest.pulls.get(p);
      return { state: data.merged ? "merged" : data.state, headSha: data.head.sha };
    },
    async createReview(p) {
      const { data } = await octokit.rest.pulls.createReview(p);
      return { id: data.id };
    },
    async dismissReview(p) {
      await octokit.rest.pulls.dismissReview(p);
    },
    async findComment({ owner, repo, issue_number, marker }) {
      const comments = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 });
      const mine = comments.filter((c) => (c.body ?? "").includes(marker));
      return mine.at(-1)?.id ?? null;
    },
    async createComment(p) {
      const { data } = await octokit.rest.issues.createComment(p);
      return { id: data.id };
    },
    async updateComment(p) {
      const { data } = await octokit.rest.issues.updateComment(p);
      return { id: data.id };
    },
    async requestReviewers(p) {
      await octokit.rest.pulls.requestReviewers(p);
    },
  };
}

const DISMISS_MESSAGE = "PullUp: superseded — the latest commit no longer warrants a change request.";

function errText(call: string, err: unknown): string {
  const e = err as { status?: number; message?: string };
  return `${call}: ${e.status ? `${e.status} ` : ""}${e.message ?? String(err)}`;
}

export class GitHubReviewActuator implements ReviewActuator {
  readonly kind = "github" as const;

  constructor(
    private readonly client: ReviewClient,
    private readonly store: PullStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async apply(actions: readonly PlannedReviewAction[]): Promise<ReviewActionRecord[]> {
    const records: ReviewActionRecord[] = [];
    for (const a of actions) records.push(await this.applyOne(a));
    return records;
  }

  private async applyOne(a: PlannedReviewAction): Promise<ReviewActionRecord> {
    const at = this.now();
    const record = async (status: ReviewActionRecord["status"], delivery?: ReviewDelivery) => {
      const rec: ReviewActionRecord = { ...a, status, loggedAt: at, ...(delivery ? { delivery } : {}) };
      await this.store.recordReviewAction(rec);
      return rec;
    };

    if (a.authority === "off") return record("suppressed");
    const delivered = await deliveredRecord(this.store, a);
    if (delivered) return delivered;

    const [owner, repo] = a.repoId.split("/") as [string, string];
    const pr = { owner, repo, pull_number: a.pullNumber };
    if (!a.headSha) return record("skipped", { at, skipped: "No head sha for this PR; re-ingest it." });
    try {
      const live = await this.client.getPull(pr);
      if (live.state !== "open") return record("skipped", { at, skipped: `PR is ${live.state}.` });
      if (live.headSha !== a.headSha) {
        return record("skipped", {
          at,
          skipped: `Head moved to ${live.headSha.slice(0, 7)} (planned for ${a.headSha.slice(0, 7)}); the next event re-plans it.`,
        });
      }
    } catch (err) {
      return record("failed", { at, errors: [errText("pulls.get", err)] });
    }

    const prior = await this.store.listReviewActions(a.repoId, a.pullNumber);
    // A retry of this same key keeps whatever already landed.
    const retry = prior.find((r) => r.headSha === a.headSha && r.action === a.action)?.delivery;
    const errors: string[] = [];
    let reviewId = retry?.reviewId;
    let commentId: number | undefined;
    let reviewersRequested = retry?.reviewersRequested;
    const dismissed = [...(retry?.dismissedReviewIds ?? [])];

    const upsert = a.call.upsertComment;
    if (upsert) {
      const newestFirst = [...prior].sort((x, y) => (y.delivery?.at ?? y.loggedAt).localeCompare(x.delivery?.at ?? x.loggedAt));
      const known = [retry?.commentId, ...newestFirst.map((r) => r.delivery?.commentId)].find((id) => id != null);
      try {
        commentId = await this.upsertComment(upsert, known);
      } catch (err) {
        errors.push(errText("comment", err));
      }
    }

    const review = a.call.createReview;
    if (review && reviewId == null) {
      try {
        reviewId = (await this.client.createReview({ ...review })).id;
      } catch (err) {
        errors.push(errText(`pulls.createReview ${review.event}`, err));
      }
    }

    const req = a.call.requestReviewers;
    if (req && !reviewersRequested) {
      try {
        await this.client.requestReviewers({ ...req, reviewers: [...req.reviewers] });
        reviewersRequested = req.reviewers;
      } catch (err) {
        errors.push(errText("pulls.requestReviewers", err));
      }
    }

    if (a.action !== "request_changes") {
      const alreadyDismissed = new Set([...dismissed, ...prior.flatMap((r) => r.delivery?.dismissedReviewIds ?? [])]);
      const stale = prior
        .filter((r) => r.action === "request_changes" && r.headSha !== a.headSha && r.delivery?.reviewId != null)
        .map((r) => r.delivery!.reviewId!)
        .filter((id) => !alreadyDismissed.has(id));
      for (const id of stale) {
        try {
          await this.client.dismissReview({ ...pr, review_id: id, message: DISMISS_MESSAGE });
          dismissed.push(id);
        } catch (err) {
          errors.push(errText("pulls.dismissReview", err));
        }
      }
    }

    const delivery: ReviewDelivery = {
      at,
      ...(reviewId != null ? { reviewId } : {}),
      ...(commentId != null ? { commentId } : {}),
      ...(reviewersRequested ? { reviewersRequested } : {}),
      ...(dismissed.length > 0 ? { dismissedReviewIds: dismissed } : {}),
      ...(errors.length > 0 ? { errors } : {}),
    };
    return record(errors.length > 0 ? "failed" : "sent", delivery);
  }

  /** Edits PullUp's comment (known id, else found by marker); creates it if neither works. */
  private async upsertComment(
    c: NonNullable<PlannedReviewAction["call"]["upsertComment"]>,
    knownId: number | undefined,
  ): Promise<number> {
    const { owner, repo, issue_number, marker, body } = c;
    const candidates = [knownId];
    if (knownId == null) candidates.push((await this.client.findComment({ owner, repo, issue_number, marker })) ?? undefined);
    for (const id of candidates) {
      if (id == null) continue;
      try {
        return (await this.client.updateComment({ owner, repo, comment_id: id, body })).id;
      } catch (err) {
        // Deleted or not ours (403/404): fall through to a fresh comment.
        const status = (err as { status?: number }).status;
        if (status !== 404 && status !== 403) throw err;
      }
    }
    return (await this.client.createComment({ owner, repo, issue_number, body })).id;
  }
}

/**
 * The actuator for this process: live when delivery is `live` (credentials
 * required — a misconfigured live deployment fails loudly instead of silently
 * logging), otherwise the logging actuator.
 */
export async function createReviewActuator(
  store: PullStore,
  repoId: string,
  opts: { readonly delivery: DeliveryMode; readonly env?: GitHubEnv; readonly now?: () => string },
): Promise<ReviewActuator> {
  if (opts.delivery !== "live") return new LoggingReviewActuator(store, opts.now);
  const octokit = await createRepoOctokit(repoId, opts.env);
  return new GitHubReviewActuator(octokitReviewClient(octokit), store, opts.now);
}
