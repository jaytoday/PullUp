// @pullup/core — domain data model.
//
// PullUp's engine is deterministic and offline. These are the plain types that
// every layer (ingest, analytics, cost model, report, db) shares. All timestamps
// are ISO-8601 UTC strings; durations are numbers in hours unless stated.

export type PullState = "open" | "closed" | "merged";

export type ChangeType = "feature" | "bugfix" | "dependency" | "refactor" | "docs" | "other";

export type SizeBucket = "xs" | "s" | "m" | "l" | "xl";

export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";

/** Final review outcome for a pull: the state of its most recent review. */
export type ReviewOutcome = "approved" | "changes_requested" | "commented" | "none";

export type DefectProxyKind = "revert" | "hotfix" | "followup_fix" | "reopen";

/** Approximated reason a merged pull later shipped a defect. */
export type DefectProxy = DefectProxyKind | null;

export interface RepositoryRecord {
  readonly repoId: string;
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
  readonly ingestedAt: string;
}

export interface PullRecord {
  readonly repoId: string;
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
  /** Derived by the ingest pipeline — see ingest/classify.ts + schema/metrics.ts. */
  readonly changeType: ChangeType;
  readonly area: string;
  readonly sizeBucket: SizeBucket;
  readonly defectProxy: DefectProxy;
  readonly firstReviewRequestedAt: string | null;
  readonly firstHumanReviewAt: string | null;
  readonly reviewCompletedAt: string | null;
  readonly reviewHours: number | null;
  readonly totalReviewHours: number | null;
  readonly reviewOutcome: ReviewOutcome;
  /** True when any review requested changes — the efficacy/findings proxy. */
  readonly hadFindings: boolean;
  readonly reviewCount: number;
  readonly commentCount: number;
}

export interface ReviewRecord {
  readonly repoId: string;
  readonly pullNumber: number;
  readonly id: number;
  readonly author: string;
  readonly submittedAt: string;
  readonly state: ReviewState;
  readonly body: string | null;
}

export interface ReviewCommentRecord {
  readonly repoId: string;
  readonly pullNumber: number;
  readonly id: number;
  readonly author: string;
  readonly createdAt: string;
  readonly path: string | null;
  readonly body: string;
}

export interface DefectEventRecord {
  readonly repoId: string;
  readonly pullNumber: number;
  readonly kind: DefectProxyKind;
  readonly at: string;
  readonly detail: string | null;
}

/** One unified-diff hunk of one file in a pull (the Jev evaluation unit). */
export interface HunkRecord {
  readonly repoId: string;
  readonly pullNumber: number;
  readonly path: string;
  readonly index: number;
  /** The `@@ -a,b +c,d @@` header, or "" for a whole-file marker. */
  readonly header: string;
  /** Hunk body (without the header). Empty when GitHub returned no patch. */
  readonly patch: string;
  /** True when the file had no patch (binary / too large) — never auto-trusted. */
  readonly noPatch: boolean;
  readonly contentHash: string;
}

/** Whole hours between two ISO timestamps (b - a), ≥ 0. */
export function hoursBetween(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a);
  return Math.max(0, ms) / 3_600_000;
}

/** Adds `hours` to an ISO timestamp, returning ISO. */
export function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

/** Parses "owner/repo" into { owner, repo }. Throws on malformed input. */
export function parseRepoId(repoId: string): { owner: string; repo: string } {
  const [owner, repo, ...rest] = repoId.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Invalid repo id "${repoId}" — expected "owner/repo".`);
  }
  return { owner: owner.toLowerCase(), repo: repo.toLowerCase() };
}

/** Median and friends over a number array. */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const a = sorted[mid - 1] ?? 0;
  const b = sorted[mid] ?? 0;
  return (a + b) / 2;
}
