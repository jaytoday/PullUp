// The persistence seam `@pullup/core` depends on. Implementations: `@pullup/db`
// (SQLite via libsql + drizzle, and an in-memory store for fixtures/tests).
//
// Every method is async so the SQLite implementation can be; the in-memory
// implementation simply resolves. Upserts are idempotent on primary keys.

import type {
  DefectEventRecord,
  PullRecord,
  RepositoryRecord,
  ReviewCommentRecord,
  ReviewRecord,
} from "./domain.js";

export interface PullStore {
  readonly kind: "memory" | "sqlite";

  upsertRepository(repo: RepositoryRecord): Promise<void>;
  getRepository(repoId: string): Promise<RepositoryRecord | null>;

  upsertPull(pull: PullRecord): Promise<void>;
  getPull(repoId: string, number: number): Promise<PullRecord | null>;

  upsertReview(review: ReviewRecord): Promise<void>;
  upsertReviewComment(comment: ReviewCommentRecord): Promise<void>;
  upsertDefectEvent(event: DefectEventRecord): Promise<void>;

  listPulls(repoId: string): Promise<PullRecord[]>;
  listMergedPulls(repoId: string): Promise<PullRecord[]>;
  listReviews(repoId: string, pullNumber?: number): Promise<ReviewRecord[]>;
  listReviewComments(repoId: string, pullNumber?: number): Promise<ReviewCommentRecord[]>;
  listDefectEvents(repoId: string, pullNumber?: number): Promise<DefectEventRecord[]>;

  /** Repositories that have been ingested at least once. */
  listRepositories(): Promise<string[]>;
}

/** In-memory PullStore for fixtures, tests, and the offline CLI default. */
export class InMemoryStore implements PullStore {
  readonly kind = "memory" as const;
  private repositories = new Map<string, RepositoryRecord>();
  private pulls = new Map<string, PullRecord>();
  private reviews = new Map<string, ReviewRecord>();
  private comments = new Map<string, ReviewCommentRecord>();
  private defects = new Map<string, DefectEventRecord>();

  private keyPull(repoId: string, number: number): string {
    return `${repoId}#${number}`;
  }

  private keyReview(repoId: string, pullNumber: number, id: number): string {
    return `${repoId}#${pullNumber}#${id}`;
  }

  private keyDefect(event: DefectEventRecord): string {
    return `${event.repoId}#${event.pullNumber}#${event.kind}#${event.at}`;
  }

  async upsertRepository(repo: RepositoryRecord): Promise<void> {
    this.repositories.set(repo.repoId, repo);
  }

  async getRepository(repoId: string): Promise<RepositoryRecord | null> {
    return this.repositories.get(repoId) ?? null;
  }

  async upsertPull(pull: PullRecord): Promise<void> {
    this.pulls.set(this.keyPull(pull.repoId, pull.number), pull);
  }

  async getPull(repoId: string, number: number): Promise<PullRecord | null> {
    return this.pulls.get(this.keyPull(repoId, number)) ?? null;
  }

  async upsertReview(review: ReviewRecord): Promise<void> {
    this.reviews.set(this.keyReview(review.repoId, review.pullNumber, review.id), review);
  }

  async upsertReviewComment(comment: ReviewCommentRecord): Promise<void> {
    this.comments.set(this.keyReview(comment.repoId, comment.pullNumber, comment.id), comment);
  }

  async upsertDefectEvent(event: DefectEventRecord): Promise<void> {
    this.defects.set(this.keyDefect(event), event);
  }

  async listPulls(repoId: string): Promise<PullRecord[]> {
    return [...this.pulls.values()].filter((p) => p.repoId === repoId);
  }

  async listMergedPulls(repoId: string): Promise<PullRecord[]> {
    return (await this.listPulls(repoId)).filter((p) => p.state === "merged");
  }

  async listReviews(repoId: string, pullNumber?: number): Promise<ReviewRecord[]> {
    return [...this.reviews.values()].filter(
      (r) => r.repoId === repoId && (pullNumber === undefined || r.pullNumber === pullNumber),
    );
  }

  async listReviewComments(repoId: string, pullNumber?: number): Promise<ReviewCommentRecord[]> {
    return [...this.comments.values()].filter(
      (c) => c.repoId === repoId && (pullNumber === undefined || c.pullNumber === pullNumber),
    );
  }

  async listDefectEvents(repoId: string, pullNumber?: number): Promise<DefectEventRecord[]> {
    return [...this.defects.values()].filter(
      (d) => d.repoId === repoId && (pullNumber === undefined || d.pullNumber === pullNumber),
    );
  }

  async listRepositories(): Promise<string[]> {
    return [...this.repositories.keys()];
  }
}
