// The GitHub-read seam `@pullup/core` depends on. Implementations live in
// `@pullup/github`: a synthetic-fixture source (offline default) and a live
// GitHub App adapter. Ingest never talks to GitHub directly.

import type {
  DefectProxyKind,
  PullState,
  ReviewState,
} from "../schema/domain.js";

export interface SourceRepo {
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
}

export interface SourcePull {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly mergedAt: string | null;
  readonly state: PullState;
  readonly baseBranch: string;
  readonly headSha: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly labels: readonly string[];
  readonly draft: boolean;
  readonly files: readonly string[];
}

export interface SourceReview {
  readonly id: number;
  readonly author: string;
  readonly submittedAt: string;
  readonly state: ReviewState;
  readonly body: string | null;
}

export interface SourceReviewComment {
  readonly id: number;
  readonly author: string;
  readonly createdAt: string;
  readonly path: string | null;
  readonly body: string;
}

export interface SourceDefectEvent {
  readonly kind: DefectProxyKind;
  readonly at: string;
  readonly detail: string | null;
}

export interface PullSource {
  readonly repoId: string;
  readRepository(): Promise<SourceRepo>;
  listPulls(): Promise<SourcePull[]>;
  listReviews(pullNumber: number): Promise<SourceReview[]>;
  listReviewComments(pullNumber: number): Promise<SourceReviewComment[]>;
  listDefectEvents(pullNumber: number): Promise<SourceDefectEvent[]>;
}

/** Validates that a fixture JSON payload conforms to the source contract. */
export interface FixtureFile {
  readonly repo: SourceRepo;
  readonly pulls: ReadonlyArray<
    SourcePull & {
      readonly reviews?: readonly SourceReview[];
      readonly reviewComments?: readonly SourceReviewComment[];
      readonly defectEvents?: readonly SourceDefectEvent[];
    }
  >;
}
