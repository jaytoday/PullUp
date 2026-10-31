// The live review actuator: sends governed review actions to GitHub.
//
// Per action, in order:
//   1. authority — refuse anything the authorizer denied, then re-check the
//                  permit *now* (signature, expiry, single use, bound to this
//                  task, call, head, config hash and agent version; stop switch
//                  and quarantine re-read) — `checkExecution` in @pullup/core;
//   2. credential — mint a token for this one repo and the minimum
//                  permissions (GitHub App), used only for this action;
//   3. guard   — skip if the PR is closed or its head moved past the planned
//                sha (the next webhook re-plans), or if this exact
//                (pull, head, action) was already delivered;
//   4. comment — upsert PullUp's single decision comment (edited in place);
//   5. review  — pulls.createReview (APPROVE / REQUEST_CHANGES), pinned to the
//                planned commit so an approval never covers newer code;
//   6. reviewers — pulls.requestReviewers for an `act`-level deferral;
//   7. dismiss — PullUp's own earlier REQUEST_CHANGES on an older head, once
//                the current head no longer warrants one (act level only);
//   7b. check  — PullUp's check run on this head (created, or updated in place
//                when one with the same name exists), when checks are on;
//   7c. inline — new finding comments as one COMMENT review (skipping any whose
//                marker is already on the PR), then PullUp's own threads whose
//                finding is gone: reply, resolve. Only threads PullUp recorded
//                posting (finding_comments) are ever resolved;
//   8. verify  — re-read GitHub: the review exists, with the planned event, on
//                the planned commit; the comment carries this task's marker;
//                the check has the planned conclusion on the planned head;
//   9. revoke  — the token, whatever happened;
//  10. evidence — every step above is appended to the hash-chained record.
//
// A partly failed action is recorded `failed` with what did succeed, so a
// retry never repeats a review that already landed. It never plans anything:
// what to send is decided by @pullup/core (planReviewActions + governActions).

import type { Octokit } from "@octokit/rest";
import type {
  CheckRunCall,
  DeliveryMode,
  FindingCommentRecord,
  GitHubReviewCall,
  ExecutionGuard,
  PlannedReviewAction,
  PullStore,
  ReviewActionRecord,
  ReviewActuator,
  ReviewDelivery,
} from "@pullup/core";
import {
  FINDING_MARKER_PREFIX,
  LoggingReviewActuator,
  appendEvidence,
  checkExecution,
  deliveredRecord,
  outcomeEvidence,
  planEvidence,
  taskMarker,
  withoutPermit,
} from "@pullup/core";
import type { GitHubEnv } from "./auth.js";
import type { CredentialBroker, ScopedCredential } from "./credentials.js";
import { createCredentialBroker } from "./credentials.js";

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
  /**
   * Newest issue comment containing `marker` that this credential wrote, or
   * null. Anyone can paste the marker, and an App may edit any comment, so a
   * comment by someone else must never be picked up and overwritten.
   */
  findComment(p: { owner: string; repo: string; issue_number: number; marker: string }): Promise<number | null>;
  createComment(p: { owner: string; repo: string; issue_number: number; body: string }): Promise<{ id: number }>;
  updateComment(p: { owner: string; repo: string; comment_id: number; body: string }): Promise<{ id: number }>;
  requestReviewers(p: { owner: string; repo: string; pull_number: number; reviewers: string[] }): Promise<void>;
  /** Reviews on the PR (for post-send verification). */
  listReviews(p: { owner: string; repo: string; pull_number: number }): Promise<Array<{ id: number; state: string; commitId: string | null }>>;
  /** Newest check run named `name` on commit `ref`, or null. */
  findCheckRun(p: { owner: string; repo: string; ref: string; name: string }): Promise<number | null>;
  createCheckRun(p: CheckRunCall): Promise<{ id: number }>;
  updateCheckRun(p: CheckRunCall & { check_run_id: number }): Promise<{ id: number }>;
  getCheckRun(p: { owner: string; repo: string; check_run_id: number }): Promise<{ id: number; name: string; headSha: string; conclusion: string | null }>;
  /** pulls.createReview with inline comments (event COMMENT). */
  createInlineReview(p: InlineReviewCall): Promise<{ id: number }>;
  /** Review comments on the PR (for the marker duplicate guard and to learn new comment ids). */
  listReviewComments(p: { owner: string; repo: string; pull_number: number }): Promise<Array<{ id: number; body: string; reviewId: number | null }>>;
  /** Review threads (GraphQL): id, resolved state, and the id of the thread's first comment. */
  listReviewThreads(p: { owner: string; repo: string; pull_number: number }): Promise<Array<{ id: string; isResolved: boolean; firstCommentId: number | null }>>;
  replyToReviewComment(p: { owner: string; repo: string; pull_number: number; comment_id: number; body: string }): Promise<void>;
  resolveReviewThread(p: { threadId: string }): Promise<void>;
}

type InlineReviewCall = NonNullable<GitHubReviewCall["inlineReview"]>;

const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved comments(first: 1) { nodes { databaseId } } }
      }
    }
  }
}`;

type ThreadsPage = {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ id: string; isResolved: boolean; comments: { nodes: Array<{ databaseId: number | null }> } }>;
      };
    } | null;
  } | null;
};

/** The finding key in one of PullUp's inline comment bodies, if any. */
export function findingKeyIn(body: string): string | null {
  const at = body.indexOf(FINDING_MARKER_PREFIX);
  if (at < 0) return null;
  const m = /^([0-9a-f]{16}) -->/.exec(body.slice(at + FINDING_MARKER_PREFIX.length));
  return m ? m[1]! : null;
}

const checkPayload = (c: CheckRunCall) => ({
  owner: c.owner,
  repo: c.repo,
  name: c.name,
  head_sha: c.head_sha,
  status: c.status,
  conclusion: c.conclusion,
  output: { ...c.output, annotations: c.output.annotations.map((a) => ({ ...a })) },
});

export function octokitReviewClient(octokit: Octokit): ReviewClient {
  // The login this credential acts as ("<app-slug>[bot]" for an App, the user for a token).
  let viewer: Promise<string> | undefined;
  const viewerLogin = () =>
    (viewer ??= octokit.graphql<{ viewer: { login: string } }>("query { viewer { login } }").then((d) => d.viewer.login));
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
      const self = await viewerLogin();
      const mine = comments.filter((c) => (c.body ?? "").includes(marker) && c.user?.login === self);
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
    async listReviews(p) {
      const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, { ...p, per_page: 100 });
      return reviews.map((r) => ({ id: r.id, state: r.state, commitId: r.commit_id ?? null }));
    },
    async findCheckRun({ owner, repo, ref, name }) {
      const { data } = await octokit.rest.checks.listForRef({ owner, repo, ref, check_name: name, filter: "latest", per_page: 100 });
      return data.check_runs[0]?.id ?? null;
    },
    async createCheckRun(c) {
      const { data } = await octokit.rest.checks.create(checkPayload(c));
      return { id: data.id };
    },
    async updateCheckRun(c) {
      const { head_sha: _sha, ...rest } = checkPayload(c);
      const { data } = await octokit.rest.checks.update({ ...rest, check_run_id: c.check_run_id });
      return { id: data.id };
    },
    async getCheckRun(p) {
      const { data } = await octokit.rest.checks.get(p);
      return { id: data.id, name: data.name, headSha: data.head_sha, conclusion: data.conclusion ?? null };
    },
    async createInlineReview(p) {
      const { data } = await octokit.rest.pulls.createReview({
        owner: p.owner,
        repo: p.repo,
        pull_number: p.pull_number,
        commit_id: p.commit_id,
        event: p.event,
        body: p.body,
        comments: p.comments.map((c) => ({
          path: c.path,
          body: c.body,
          line: c.line,
          side: c.side,
          ...(c.start_line !== undefined ? { start_line: c.start_line, start_side: c.start_side } : {}),
        })),
      });
      return { id: data.id };
    },
    async listReviewComments(p) {
      const rows = await octokit.paginate(octokit.rest.pulls.listReviewComments, { ...p, per_page: 100 });
      return rows.map((c) => ({ id: c.id, body: c.body ?? "", reviewId: c.pull_request_review_id ?? null }));
    },
    async listReviewThreads({ owner, repo, pull_number }) {
      const out: Array<{ id: string; isResolved: boolean; firstCommentId: number | null }> = [];
      let after: string | null = null;
      for (let page = 0; page < 20; page++) {
        const data: ThreadsPage = await octokit.graphql<ThreadsPage>(THREADS_QUERY, { owner, repo, number: pull_number, after });
        const threads = data.repository?.pullRequest?.reviewThreads;
        if (!threads) break;
        for (const t of threads.nodes) out.push({ id: t.id, isResolved: t.isResolved, firstCommentId: t.comments.nodes[0]?.databaseId ?? null });
        if (!threads.pageInfo.hasNextPage) break;
        after = threads.pageInfo.endCursor;
      }
      return out;
    },
    async replyToReviewComment(p) {
      await octokit.rest.pulls.createReplyForReviewComment(p);
    },
    async resolveReviewThread({ threadId }) {
      await octokit.graphql(`mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }`, { id: threadId });
    },
  };
}

const DISMISS_MESSAGE = "PullUp: superseded — the latest commit no longer warrants a change request.";

function errText(call: string, err: unknown): string {
  const e = err as { status?: number; message?: string };
  return `${call}: ${e.status ? `${e.status} ` : ""}${e.message ?? String(err)}`;
}

function landedIds(d: ReviewDelivery): Partial<ReviewDelivery> {
  return {
    ...(d.reviewId != null ? { reviewId: d.reviewId } : {}),
    ...(d.commentId != null ? { commentId: d.commentId } : {}),
    ...(d.checkRunId != null ? { checkRunId: d.checkRunId } : {}),
    ...(d.reviewersRequested ? { reviewersRequested: d.reviewersRequested } : {}),
    ...(d.dismissedReviewIds ? { dismissedReviewIds: d.dismissedReviewIds } : {}),
  };
}

const REVIEW_STATE: Readonly<Record<string, string>> = { APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED", COMMENT: "COMMENTED" };

export interface GitHubActuatorOptions {
  /** Re-checks each permit immediately before sending (required: no guard, no send). */
  readonly guard: ExecutionGuard;
  readonly now?: () => string;
}

export class GitHubReviewActuator implements ReviewActuator {
  readonly kind = "github" as const;
  private readonly now: () => string;

  constructor(
    private readonly broker: CredentialBroker,
    private readonly store: PullStore,
    private readonly opts: GitHubActuatorOptions,
  ) {
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  async apply(actions: readonly PlannedReviewAction[]): Promise<ReviewActionRecord[]> {
    const records: ReviewActionRecord[] = [];
    for (const a of actions) records.push(await this.applyOne(a));
    return records;
  }

  private evidence(a: PlannedReviewAction, kind: "credential" | "verified" | "revoked", at: string, payload: Record<string, unknown>) {
    if (!a.taskId || !a.task) return Promise.resolve();
    return appendEvidence(this.store, { repoId: a.repoId, taskId: a.taskId, agentVersion: a.task.agent.version, kind, at, payload }).then(() => undefined);
  }

  private async applyOne(a: PlannedReviewAction): Promise<ReviewActionRecord> {
    const at = this.now();
    const record = async (status: ReviewActionRecord["status"], delivery?: ReviewDelivery) => {
      // Keep the ids of whatever already landed for this key, so a later retry never repeats it.
      const prior = (await this.store.listReviewActions(a.repoId, a.pullNumber)).find((r) => r.headSha === a.headSha && r.action === a.action)?.delivery;
      const landed = prior ? landedIds(prior) : {};
      const merged = delivery ? { ...landed, ...delivery } : Object.keys(landed).length > 0 ? { at, ...landed } : undefined;
      const rec: ReviewActionRecord = { ...withoutPermit(a), status, loggedAt: at, ...(merged ? { delivery: merged } : {}) };
      await this.store.recordReviewAction(rec);
      const outcome = outcomeEvidence(rec);
      if (outcome) await appendEvidence(this.store, outcome);
      return rec;
    };
    // Already delivered: nothing to send, and the delivered record must survive (no re-send after a resume).
    const delivered = await deliveredRecord(this.store, a);
    if (delivered) return delivered;
    for (const e of planEvidence(a, at)) await appendEvidence(this.store, e);
    if (a.authorization?.decision === "deny") return record("denied", { at, denied: a.authorization.reasons });
    if (a.authority === "off") return record("suppressed");
    if (!a.headSha) return record("skipped", { at, skipped: "No head sha for this PR; re-ingest it." });

    // 1. Authority, re-checked now.
    const denied = await checkExecution(this.store, a, this.opts.guard, at);
    if (denied.length > 0) return record("denied", { at, denied });

    // 2. A credential for this action only.
    const permissions = a.permit!.claims.permissions;
    let cred: ScopedCredential;
    try {
      cred = await this.broker.mint(a.repoId, permissions);
    } catch (err) {
      return record("failed", { at, errors: [errText("credential", err)] });
    }
    await this.evidence(a, "credential", at, { kind: cred.kind, repositories: cred.repositories, permissions: cred.permissions });
    let delivery: ReviewDelivery;
    let status: ReviewActionRecord["status"];
    try {
      ({ status, delivery } = await this.send(a, cred.client, at));
    } finally {
      const r = await cred.revoke();
      await this.evidence(a, "revoked", this.now(), { ...r });
      const credential = {
        kind: cred.kind,
        repositories: cred.repositories,
        permissions: cred.permissions,
        revoked: r.revoked,
        ...(r.error ? { revokeError: r.error } : {}),
      };
      delivery = { ...delivery!, credential };
    }
    return record(status!, delivery);
  }

  private async send(
    a: PlannedReviewAction,
    client: ReviewClient,
    at: string,
  ): Promise<{ status: ReviewActionRecord["status"]; delivery: ReviewDelivery }> {
    const [owner, repo] = a.repoId.split("/") as [string, string];
    const pr = { owner, repo, pull_number: a.pullNumber };
    try {
      const live = await client.getPull(pr);
      if (live.state !== "open") return { status: "skipped", delivery: { at, skipped: `PR is ${live.state}.` } };
      if (live.headSha !== a.headSha) {
        return {
          status: "skipped",
          delivery: {
            at,
            skipped: `Head moved to ${live.headSha.slice(0, 7)} (planned for ${a.headSha.slice(0, 7)}); the next event re-plans it.`,
          },
        };
      }
    } catch (err) {
      return { status: "failed", delivery: { at, errors: [errText("pulls.get", err)] } };
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
        commentId = await this.upsertComment(client, upsert, known);
      } catch (err) {
        errors.push(errText("comment", err));
      }
    }

    const review = a.call.createReview;
    let createdNow = false;
    if (review && reviewId == null) {
      try {
        reviewId = (await client.createReview({ ...review })).id;
        createdNow = true;
      } catch (err) {
        errors.push(errText(`pulls.createReview ${review.event}`, err));
      }
    }

    const req = a.call.requestReviewers;
    if (req && !reviewersRequested) {
      try {
        await client.requestReviewers({ ...req, reviewers: [...req.reviewers] });
        reviewersRequested = req.reviewers;
      } catch (err) {
        errors.push(errText("pulls.requestReviewers", err));
      }
    }

    // Dismissing a block unblocks a merge: only an act-level action may do it.
    if (a.action !== "request_changes" && a.authority === "act") {
      const alreadyDismissed = new Set([...dismissed, ...prior.flatMap((r) => r.delivery?.dismissedReviewIds ?? [])]);
      const stale = prior
        .filter((r) => r.action === "request_changes" && r.headSha !== a.headSha && r.delivery?.reviewId != null)
        .map((r) => r.delivery!.reviewId!)
        .filter((id) => !alreadyDismissed.has(id));
      for (const id of stale) {
        try {
          await client.dismissReview({ ...pr, review_id: id, message: DISMISS_MESSAGE });
          dismissed.push(id);
        } catch (err) {
          errors.push(errText("pulls.dismissReview", err));
        }
      }
    }

    // The check run: one per (head, name); an existing one is updated in place.
    let checkRunId: number | undefined;
    const check = a.call.checkRun;
    if (check) {
      try {
        const existing = retry?.checkRunId ?? (await client.findCheckRun({ owner, repo, ref: check.head_sha, name: check.name }));
        checkRunId =
          existing != null
            ? (await client.updateCheckRun({ ...check, check_run_id: existing })).id
            : (await client.createCheckRun(check)).id;
      } catch (err) {
        errors.push(errText("checks", err));
      }
    }

    // Inline finding comments: post new ones, resolve PullUp's own fixed ones.
    let inline: ReviewDelivery["inline"];
    if (a.call.inlineReview || a.call.resolveThreads?.length || a.inline?.keep.length) {
      inline = await this.sendInline(a, client, at, errors);
    }

    // VAL-04: confirm on GitHub that what we sent is what landed.
    let verified: ReviewDelivery["verified"];
    if (errors.length === 0 && (createdNow || commentId != null || checkRunId != null || inline)) {
      verified = await this.verify(client, a, pr, createdNow ? reviewId : undefined, commentId, checkRunId, inline);
      await this.evidence(a, "verified", this.now(), { ...verified });
      if (!verified.ok) errors.push(`verification: ${verified.detail}`);
    }

    const delivery: ReviewDelivery = {
      at,
      ...(reviewId != null ? { reviewId } : {}),
      ...(commentId != null ? { commentId } : {}),
      ...(checkRunId != null ? { checkRunId } : {}),
      ...(inline ? { inline } : {}),
      ...(reviewersRequested ? { reviewersRequested } : {}),
      ...(dismissed.length > 0 ? { dismissedReviewIds: dismissed } : {}),
      ...(errors.length > 0 ? { errors } : {}),
      ...(verified ? { verified } : {}),
    };
    return { status: errors.length > 0 ? "failed" : "sent", delivery };
  }

  private async verify(
    client: ReviewClient,
    a: PlannedReviewAction,
    pr: { owner: string; repo: string; pull_number: number },
    reviewId: number | undefined,
    commentId: number | undefined,
    checkRunId?: number,
    inline?: ReviewDelivery["inline"],
  ): Promise<{ ok: boolean; detail: string }> {
    const checks: string[] = [];
    try {
      if (reviewId != null && a.call.createReview) {
        const r = (await client.listReviews(pr)).find((x) => x.id === reviewId);
        const want = REVIEW_STATE[a.call.createReview.event];
        if (!r) return { ok: false, detail: `review ${reviewId} is not on the PR` };
        if (r.state !== want) return { ok: false, detail: `review ${reviewId} is ${r.state}, expected ${want}` };
        if (r.commitId !== a.headSha) return { ok: false, detail: `review ${reviewId} is on ${String(r.commitId).slice(0, 7)}, expected ${a.headSha.slice(0, 7)}` };
        checks.push(`review ${reviewId} ${want} on ${a.headSha.slice(0, 7)}`);
      }
      if (commentId != null && a.call.upsertComment && a.taskId) {
        const found = await client.findComment({
          owner: pr.owner,
          repo: pr.repo,
          issue_number: pr.pull_number,
          marker: taskMarker(a.taskId),
        });
        if (found !== commentId) return { ok: false, detail: `comment ${commentId} does not carry this task's marker` };
        checks.push(`comment ${commentId} carries task ${a.taskId}`);
      }
      const plannedCheck = a.call.checkRun;
      if (checkRunId != null && plannedCheck) {
        const c = await client.getCheckRun({ owner: pr.owner, repo: pr.repo, check_run_id: checkRunId });
        if (c.headSha !== plannedCheck.head_sha) return { ok: false, detail: `check ${checkRunId} is on ${c.headSha.slice(0, 7)}, expected ${plannedCheck.head_sha.slice(0, 7)}` };
        if (c.conclusion !== plannedCheck.conclusion) return { ok: false, detail: `check ${checkRunId} is ${String(c.conclusion)}, expected ${plannedCheck.conclusion}` };
        checks.push(`check ${checkRunId} ${plannedCheck.conclusion} on ${plannedCheck.head_sha.slice(0, 7)}`);
      }
      if (inline && (inline.posted.length > 0 || inline.resolved.length > 0)) {
        const byId = new Map((await client.listReviewComments(pr)).map((c) => [c.id, c.body]));
        for (const p of inline.posted) {
          if (findingKeyIn(byId.get(p.commentId) ?? "") !== p.findingKey) return { ok: false, detail: `inline comment ${p.commentId} does not carry finding ${p.findingKey}` };
        }
        if (inline.resolved.length > 0) {
          const stored = new Map((await this.store.listFindingComments(a.repoId, a.pullNumber)).map((r) => [r.findingKey, r.commentId]));
          const threads = await client.listReviewThreads(pr);
          for (const key of inline.resolved) {
            const t = threads.find((x) => x.firstCommentId === stored.get(key));
            if (!t?.isResolved) return { ok: false, detail: `finding thread ${key} is not resolved` };
          }
        }
        checks.push(`${inline.posted.length} inline comment(s), ${inline.resolved.length} resolved`);
      }
    } catch (err) {
      return { ok: false, detail: errText("verify", err) };
    }
    return { ok: true, detail: checks.join("; ") };
  }

  /**
   * Posts new inline finding comments (skipping any whose marker is already on
   * the PR) and resolves PullUp's own threads whose finding is gone. Records
   * every comment PullUp authored in finding_comments — the only threads it may
   * ever resolve.
   */
  private async sendInline(a: PlannedReviewAction, client: ReviewClient, at: string, errors: string[]): Promise<NonNullable<ReviewDelivery["inline"]>> {
    const [owner, repo] = a.repoId.split("/") as [string, string];
    const pr = { owner, repo, pull_number: a.pullNumber };
    const stored = new Map((await this.store.listFindingComments(a.repoId, a.pullNumber)).map((r) => [r.findingKey, r]));
    const save = (r: FindingCommentRecord) => this.store.upsertFindingComment(r);
    const posted: Array<{ findingKey: string; commentId: number }> = [];
    const resolved: string[] = [];
    const alreadyResolved: string[] = [];
    const missing: string[] = [];
    let reviewId: number | undefined;

    const review = a.call.inlineReview;
    if (review) {
      try {
        const onPr = new Set((await client.listReviewComments(pr)).map((c) => findingKeyIn(c.body)).filter((k): k is string => k !== null));
        const fresh = review.comments.filter((c) => !onPr.has(c.findingKey));
        if (fresh.length > 0) {
          reviewId = (await client.createInlineReview({ ...review, comments: fresh })).id;
          const mine = (await client.listReviewComments(pr)).filter((c) => c.reviewId === reviewId);
          for (const c of fresh) {
            const landed = mine.find((m) => findingKeyIn(m.body) === c.findingKey);
            if (!landed) {
              errors.push(`inline: comment for ${c.findingKey} did not land`);
              continue;
            }
            posted.push({ findingKey: c.findingKey, commentId: landed.id });
            await save({
              repoId: a.repoId,
              pullNumber: a.pullNumber,
              findingKey: c.findingKey,
              findingId: c.findingId,
              path: c.path,
              commentId: landed.id,
              firstHeadSha: a.headSha,
              lastSeenHeadSha: a.headSha,
              status: "open",
              resolvedHeadSha: null,
              updatedAt: at,
            });
          }
        }
      } catch (err) {
        errors.push(errText("inline review", err));
      }
    }

    for (const key of a.inline?.keep ?? []) {
      const row = stored.get(key);
      if (row && row.status === "open" && row.lastSeenHeadSha !== a.headSha) await save({ ...row, lastSeenHeadSha: a.headSha, updatedAt: at });
    }

    const toResolve = (a.call.resolveThreads ?? []).filter((r) => stored.get(r.findingKey)?.commentId === r.commentId);
    if (toResolve.length > 0) {
      try {
        const threads = await client.listReviewThreads(pr);
        for (const r of toResolve) {
          const row = stored.get(r.findingKey)!;
          const t = threads.find((x) => x.firstCommentId === r.commentId);
          if (!t) {
            missing.push(r.findingKey);
            await save({ ...row, status: "deleted", updatedAt: at });
          } else if (t.isResolved) {
            alreadyResolved.push(r.findingKey);
            await save({ ...row, status: "resolved-by-human", updatedAt: at });
          } else {
            try {
              await client.replyToReviewComment({ ...pr, comment_id: r.commentId, body: r.reply });
              await client.resolveReviewThread({ threadId: t.id });
              resolved.push(r.findingKey);
              await save({ ...row, status: "resolved-by-pullup", resolvedHeadSha: a.headSha, updatedAt: at });
            } catch (err) {
              errors.push(errText(`resolve ${r.findingKey}`, err));
            }
          }
        }
      } catch (err) {
        errors.push(errText("review threads", err));
      }
    }
    return { ...(reviewId != null ? { reviewId } : {}), posted, resolved, alreadyResolved, missing };
  }

  /** Edits PullUp's comment (known id, else found by marker); creates it if neither works. */
  private async upsertComment(
    client: ReviewClient,
    c: NonNullable<PlannedReviewAction["call"]["upsertComment"]>,
    knownId: number | undefined,
  ): Promise<number> {
    const { owner, repo, issue_number, marker, body } = c;
    const candidates = [knownId];
    if (knownId == null) candidates.push((await client.findComment({ owner, repo, issue_number, marker })) ?? undefined);
    for (const id of candidates) {
      if (id == null) continue;
      try {
        return (await client.updateComment({ owner, repo, comment_id: id, body })).id;
      } catch (err) {
        // Deleted or not ours (403/404): fall through to a fresh comment.
        const status = (err as { status?: number }).status;
        if (status !== 404 && status !== 403) throw err;
      }
    }
    return (await client.createComment({ owner, repo, issue_number, body })).id;
  }
}

/**
 * The actuator for this process: live when delivery is `live` (credentials
 * required — a misconfigured live deployment fails loudly instead of silently
 * logging), otherwise the logging actuator.
 */
export async function createReviewActuator(
  store: PullStore,
  _repoId: string,
  opts: {
    readonly delivery: DeliveryMode;
    readonly guard?: ExecutionGuard;
    readonly env?: GitHubEnv;
    readonly now?: () => string;
    readonly broker?: CredentialBroker;
  },
): Promise<ReviewActuator> {
  if (opts.delivery !== "live") return new LoggingReviewActuator(store, opts.now);
  const broker = opts.broker ?? createCredentialBroker(opts.env);
  if (!broker) throw new Error("No GitHub credentials: set GITHUB_APP_ID + GITHUB_PRIVATE_KEY (GitHub App) or GITHUB_TOKEN.");
  if (!opts.guard) throw new Error("Live delivery needs an execution guard (permit key, agent identity, config hash).");
  return new GitHubReviewActuator(broker, store, { guard: opts.guard, ...(opts.now ? { now: opts.now } : {}) });
}
