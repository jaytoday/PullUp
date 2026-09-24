// SQLite PullStore implementation (libsql + drizzle). Idempotent upserts on
// primary keys, JSON-encoded arrays, 0/1 integers for booleans.

import { and, eq } from "drizzle-orm";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type {
  DefectEventRecord,
  HunkRecord,
  PullRecord,
  ReviewActionRecord,
  SignalRecord,
  SignalRunRecord,
  RepositoryRecord,
  ReviewCommentRecord,
  ReviewRecord,
} from "@pullup/core";
import type { PullStore } from "@pullup/core";
import {
  defectEvents,
  hunks,
  pulls,
  repositories,
  reviewActions,
  reviewComments,
  reviews,
  signalRuns,
  signals,
} from "./schema.js";

function toBool(n: number | null): boolean {
  return n === 1;
}

function toInt(b: boolean): number {
  return b ? 1 : 0;
}

function toPull(row: typeof pulls.$inferSelect): PullRecord {
  return {
    repoId: row.repoId,
    number: row.number,
    title: row.title,
    author: row.author,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    mergedAt: row.mergedAt,
    state: row.state as PullRecord["state"],
    baseBranch: row.baseBranch,
    headSha: row.headSha,
    additions: row.additions,
    deletions: row.deletions,
    changedFiles: row.changedFiles,
    labels: JSON.parse(row.labels) as string[],
    draft: toBool(row.draft),
    files: JSON.parse(row.files) as string[],
    changeType: row.changeType as PullRecord["changeType"],
    area: row.area,
    sizeBucket: row.sizeBucket as PullRecord["sizeBucket"],
    defectProxy: (row.defectProxy ?? null) as PullRecord["defectProxy"],
    firstReviewRequestedAt: row.firstReviewRequestedAt,
    firstHumanReviewAt: row.firstHumanReviewAt,
    reviewCompletedAt: row.reviewCompletedAt,
    reviewHours: row.reviewHours,
    totalReviewHours: row.totalReviewHours,
    reviewOutcome: row.reviewOutcome as PullRecord["reviewOutcome"],
    hadFindings: toBool(row.hadFindings),
    reviewCount: row.reviewCount,
    commentCount: row.commentCount,
  };
}

export class SqliteStore implements PullStore {
  readonly kind = "sqlite" as const;
  private db: LibSQLDatabase;
  private client: Client;

  constructor(client: Client) {
    this.client = client;
    this.db = drizzle(client);
  }

  /** Creates the schema if absent. Call once per database. */
  async migrate(): Promise<void> {
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS repositories (
        repo_id TEXT PRIMARY KEY, owner TEXT NOT NULL, repo TEXT NOT NULL,
        default_branch TEXT NOT NULL, ingested_at TEXT NOT NULL)`,
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS pulls (
        repo_id TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL,
        author TEXT NOT NULL, created_at TEXT NOT NULL, closed_at TEXT,
        merged_at TEXT, state TEXT NOT NULL, base_branch TEXT NOT NULL,
        head_sha TEXT NOT NULL, additions INTEGER NOT NULL, deletions INTEGER NOT NULL,
        changed_files INTEGER NOT NULL, labels TEXT NOT NULL, draft INTEGER NOT NULL,
        files TEXT NOT NULL, change_type TEXT NOT NULL, area TEXT NOT NULL,
        size_bucket TEXT NOT NULL, defect_proxy TEXT, first_review_requested_at TEXT,
        first_human_review_at TEXT, review_completed_at TEXT, review_hours REAL,
        total_review_hours REAL, review_outcome TEXT NOT NULL, had_findings INTEGER NOT NULL,
        review_count INTEGER NOT NULL, comment_count INTEGER NOT NULL,
        PRIMARY KEY (repo_id, number))`,
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS reviews (
        repo_id TEXT NOT NULL, pull_number INTEGER NOT NULL, id INTEGER NOT NULL,
        author TEXT NOT NULL, submitted_at TEXT NOT NULL, state TEXT NOT NULL, body TEXT,
        PRIMARY KEY (repo_id, pull_number, id))`,
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS review_comments (
        repo_id TEXT NOT NULL, pull_number INTEGER NOT NULL, id INTEGER NOT NULL,
        author TEXT NOT NULL, created_at TEXT NOT NULL, path TEXT, body TEXT NOT NULL,
        PRIMARY KEY (repo_id, pull_number, id))`,
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS defect_events (
        repo_id TEXT NOT NULL, pull_number INTEGER NOT NULL, kind TEXT NOT NULL,
        at TEXT NOT NULL, detail TEXT,
        PRIMARY KEY (repo_id, pull_number, kind, at))`,
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS hunks (
        repo_id TEXT NOT NULL, pull_number INTEGER NOT NULL, path TEXT NOT NULL,
        idx INTEGER NOT NULL, header TEXT NOT NULL, patch TEXT NOT NULL,
        no_patch INTEGER NOT NULL, content_hash TEXT NOT NULL,
        PRIMARY KEY (repo_id, pull_number, path, idx))`,
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS signals (
        cache_key TEXT PRIMARY KEY, repo_id TEXT NOT NULL, pull_number INTEGER NOT NULL,
        unit_key TEXT NOT NULL, model_id TEXT NOT NULL, question_set_version TEXT NOT NULL,
        result TEXT NOT NULL, evaluated_at TEXT NOT NULL)`,
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS signal_runs (
        repo_id TEXT NOT NULL, run_at TEXT NOT NULL, model_id TEXT NOT NULL,
        summary TEXT NOT NULL, PRIMARY KEY (repo_id, run_at, model_id))`,
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS review_actions (
        repo_id TEXT NOT NULL, pull_number INTEGER NOT NULL, head_sha TEXT NOT NULL,
        action TEXT NOT NULL, record TEXT NOT NULL, logged_at TEXT NOT NULL,
        PRIMARY KEY (repo_id, pull_number, head_sha, action))`,
    );
  }

  async upsertRepository(repo: RepositoryRecord): Promise<void> {
    await this.db
      .insert(repositories)
      .values({
        repoId: repo.repoId,
        owner: repo.owner,
        repo: repo.repo,
        defaultBranch: repo.defaultBranch,
        ingestedAt: repo.ingestedAt,
      })
      .onConflictDoUpdate({
        target: repositories.repoId,
        set: {
          owner: repo.owner,
          repo: repo.repo,
          defaultBranch: repo.defaultBranch,
          ingestedAt: repo.ingestedAt,
        },
      });
  }

  async getRepository(repoId: string): Promise<RepositoryRecord | null> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.repoId, repoId));
    const r = rows[0];
    return r
      ? {
          repoId: r.repoId,
          owner: r.owner,
          repo: r.repo,
          defaultBranch: r.defaultBranch,
          ingestedAt: r.ingestedAt,
        }
      : null;
  }

  async upsertPull(pull: PullRecord): Promise<void> {
    await this.db
      .insert(pulls)
      .values({
        repoId: pull.repoId,
        number: pull.number,
        title: pull.title,
        author: pull.author,
        createdAt: pull.createdAt,
        closedAt: pull.closedAt,
        mergedAt: pull.mergedAt,
        state: pull.state,
        baseBranch: pull.baseBranch,
        headSha: pull.headSha,
        additions: pull.additions,
        deletions: pull.deletions,
        changedFiles: pull.changedFiles,
        labels: JSON.stringify(pull.labels),
        draft: toInt(pull.draft),
        files: JSON.stringify(pull.files),
        changeType: pull.changeType,
        area: pull.area,
        sizeBucket: pull.sizeBucket,
        defectProxy: pull.defectProxy,
        firstReviewRequestedAt: pull.firstReviewRequestedAt,
        firstHumanReviewAt: pull.firstHumanReviewAt,
        reviewCompletedAt: pull.reviewCompletedAt,
        reviewHours: pull.reviewHours,
        totalReviewHours: pull.totalReviewHours,
        reviewOutcome: pull.reviewOutcome,
        hadFindings: toInt(pull.hadFindings),
        reviewCount: pull.reviewCount,
        commentCount: pull.commentCount,
      })
      .onConflictDoUpdate({
        target: [pulls.repoId, pulls.number],
        set: {
          title: pull.title,
          state: pull.state,
          closedAt: pull.closedAt,
          mergedAt: pull.mergedAt,
          labels: JSON.stringify(pull.labels),
          files: JSON.stringify(pull.files),
          changeType: pull.changeType,
          area: pull.area,
          sizeBucket: pull.sizeBucket,
          defectProxy: pull.defectProxy,
          firstHumanReviewAt: pull.firstHumanReviewAt,
          reviewCompletedAt: pull.reviewCompletedAt,
          reviewHours: pull.reviewHours,
          totalReviewHours: pull.totalReviewHours,
          reviewOutcome: pull.reviewOutcome,
          hadFindings: toInt(pull.hadFindings),
          reviewCount: pull.reviewCount,
          commentCount: pull.commentCount,
        },
      });
  }

  async getPull(repoId: string, number: number): Promise<PullRecord | null> {
    const rows = await this.db
      .select()
      .from(pulls)
      .where(and(eq(pulls.repoId, repoId), eq(pulls.number, number)));
    const row = rows[0];
    return row ? toPull(row) : null;
  }

  async upsertReview(review: ReviewRecord): Promise<void> {
    await this.db
      .insert(reviews)
      .values({
        repoId: review.repoId,
        pullNumber: review.pullNumber,
        id: review.id,
        author: review.author,
        submittedAt: review.submittedAt,
        state: review.state,
        body: review.body,
      })
      .onConflictDoUpdate({
        target: [reviews.repoId, reviews.pullNumber, reviews.id],
        set: { state: review.state, body: review.body },
      });
  }

  async upsertReviewComment(comment: ReviewCommentRecord): Promise<void> {
    await this.db
      .insert(reviewComments)
      .values({
        repoId: comment.repoId,
        pullNumber: comment.pullNumber,
        id: comment.id,
        author: comment.author,
        createdAt: comment.createdAt,
        path: comment.path,
        body: comment.body,
      })
      .onConflictDoNothing();
  }

  async upsertDefectEvent(event: DefectEventRecord): Promise<void> {
    await this.db
      .insert(defectEvents)
      .values({
        repoId: event.repoId,
        pullNumber: event.pullNumber,
        kind: event.kind,
        at: event.at,
        detail: event.detail,
      })
      .onConflictDoNothing();
  }

  async listPulls(repoId: string): Promise<PullRecord[]> {
    const rows = await this.db
      .select()
      .from(pulls)
      .where(eq(pulls.repoId, repoId))
      .orderBy(pulls.number);
    return rows.map(toPull);
  }

  async listMergedPulls(repoId: string): Promise<PullRecord[]> {
    return (await this.listPulls(repoId)).filter((p) => p.state === "merged");
  }

  async listReviews(repoId: string, pullNumber?: number): Promise<ReviewRecord[]> {
    const rows = pullNumber === undefined
      ? await this.db.select().from(reviews).where(eq(reviews.repoId, repoId))
      : await this.db
          .select()
          .from(reviews)
          .where(
            and(
              eq(reviews.repoId, repoId),
              eq(reviews.pullNumber, pullNumber),
            ),
          );
    return rows.map((r) => ({
      repoId: r.repoId,
      pullNumber: r.pullNumber,
      id: r.id,
      author: r.author,
      submittedAt: r.submittedAt,
      state: r.state as ReviewRecord["state"],
      body: r.body,
    }));
  }

  async listReviewComments(repoId: string, pullNumber?: number): Promise<ReviewCommentRecord[]> {
    const rows = pullNumber === undefined
      ? await this.db.select().from(reviewComments).where(eq(reviewComments.repoId, repoId))
      : await this.db
          .select()
          .from(reviewComments)
          .where(
            and(
              eq(reviewComments.repoId, repoId),
              eq(reviewComments.pullNumber, pullNumber),
            ),
          );
    return rows.map((c) => ({
      repoId: c.repoId,
      pullNumber: c.pullNumber,
      id: c.id,
      author: c.author,
      createdAt: c.createdAt,
      path: c.path,
      body: c.body,
    }));
  }

  async listDefectEvents(repoId: string, pullNumber?: number): Promise<DefectEventRecord[]> {
    const rows = pullNumber === undefined
      ? await this.db.select().from(defectEvents).where(eq(defectEvents.repoId, repoId))
      : await this.db
          .select()
          .from(defectEvents)
          .where(
            and(
              eq(defectEvents.repoId, repoId),
              eq(defectEvents.pullNumber, pullNumber),
            ),
          );
    return rows.map((d) => ({
      repoId: d.repoId,
      pullNumber: d.pullNumber,
      kind: d.kind as DefectEventRecord["kind"],
      at: d.at,
      detail: d.detail,
    }));
  }

  async listRepositories(): Promise<string[]> {
    const rows = await this.db.select({ repoId: repositories.repoId }).from(repositories);
    return rows.map((r) => r.repoId);
  }

  async replaceHunks(repoId: string, pullNumber: number, rows: readonly HunkRecord[]): Promise<void> {
    await this.db
      .delete(hunks)
      .where(and(eq(hunks.repoId, repoId), eq(hunks.pullNumber, pullNumber)));
    if (rows.length === 0) return;
    await this.db.insert(hunks).values(
      rows.map((h) => ({
        repoId: h.repoId,
        pullNumber: h.pullNumber,
        path: h.path,
        idx: h.index,
        header: h.header,
        patch: h.patch,
        noPatch: toInt(h.noPatch),
        contentHash: h.contentHash,
      })),
    );
  }

  async listHunks(repoId: string, pullNumber?: number): Promise<HunkRecord[]> {
    const rows = pullNumber === undefined
      ? await this.db.select().from(hunks).where(eq(hunks.repoId, repoId))
      : await this.db
          .select()
          .from(hunks)
          .where(and(eq(hunks.repoId, repoId), eq(hunks.pullNumber, pullNumber)));
    return rows.map((h) => ({
      repoId: h.repoId,
      pullNumber: h.pullNumber,
      path: h.path,
      index: h.idx,
      header: h.header,
      patch: h.patch,
      noPatch: toBool(h.noPatch),
      contentHash: h.contentHash,
    }));
  }

  async getSignal(cacheKey: string): Promise<SignalRecord | null> {
    const rows = await this.db.select().from(signals).where(eq(signals.cacheKey, cacheKey));
    const r = rows[0];
    return r
      ? {
          cacheKey: r.cacheKey,
          repoId: r.repoId,
          pullNumber: r.pullNumber,
          unitKey: r.unitKey,
          modelId: r.modelId,
          questionSetVersion: r.questionSetVersion,
          result: JSON.parse(r.result) as SignalRecord["result"],
          evaluatedAt: r.evaluatedAt,
        }
      : null;
  }

  async upsertSignal(signal: SignalRecord): Promise<void> {
    await this.db
      .insert(signals)
      .values({ ...signal, result: JSON.stringify(signal.result) })
      .onConflictDoUpdate({
        target: signals.cacheKey,
        set: { result: JSON.stringify(signal.result), evaluatedAt: signal.evaluatedAt },
      });
  }

  async recordSignalRun(run: SignalRunRecord): Promise<void> {
    await this.db
      .insert(signalRuns)
      .values({ repoId: run.repoId, runAt: run.runAt, modelId: run.modelId, summary: JSON.stringify(run) })
      .onConflictDoUpdate({
        target: [signalRuns.repoId, signalRuns.runAt, signalRuns.modelId],
        set: { summary: JSON.stringify(run) },
      });
  }

  async listSignalRuns(repoId: string): Promise<SignalRunRecord[]> {
    const rows = await this.db
      .select()
      .from(signalRuns)
      .where(eq(signalRuns.repoId, repoId))
      .orderBy(signalRuns.runAt);
    return rows.map((r) => JSON.parse(r.summary) as SignalRunRecord);
  }

  async recordReviewAction(action: ReviewActionRecord): Promise<void> {
    await this.db
      .insert(reviewActions)
      .values({
        repoId: action.repoId,
        pullNumber: action.pullNumber,
        headSha: action.headSha,
        action: action.action,
        record: JSON.stringify(action),
        loggedAt: action.loggedAt,
      })
      .onConflictDoUpdate({
        target: [reviewActions.repoId, reviewActions.pullNumber, reviewActions.headSha, reviewActions.action],
        set: { record: JSON.stringify(action), loggedAt: action.loggedAt },
      });
  }

  async listReviewActions(repoId: string, pullNumber?: number): Promise<ReviewActionRecord[]> {
    const rows = pullNumber === undefined
      ? await this.db.select().from(reviewActions).where(eq(reviewActions.repoId, repoId))
      : await this.db
          .select()
          .from(reviewActions)
          .where(and(eq(reviewActions.repoId, repoId), eq(reviewActions.pullNumber, pullNumber)));
    return rows.map((r) => JSON.parse(r.record) as ReviewActionRecord);
  }
}
