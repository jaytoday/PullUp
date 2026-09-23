// Deterministic change classification: change type, area, size bucket, and
// derived review metrics. Rules-first; LLM classification via a future ModelPort
// is a documented later refinement.

import type {
  ChangeType,
  PullRecord,
  SizeBucket,
} from "../schema/domain.js";
import { hoursBetween } from "../schema/domain.js";
import type { SourcePull, SourceReview, SourceReviewComment } from "./source.js";

export interface ClassificationRules {
  /** File-path prefix → area. Longest prefix wins. */
  readonly areaByPrefix: Readonly<Record<string, string>>;
  /** Label → change type. */
  readonly typeByLabel: Readonly<Record<string, ChangeType>>;
  /** File path (exact) → change type (e.g. lockfiles → dependency). */
  readonly typeByPath: Readonly<Record<string, ChangeType>>;
  readonly defaultChangeType: ChangeType;
}

export const DEFAULT_RULES: ClassificationRules = {
  areaByPrefix: {
    "src/api/": "api",
    "src/core/": "core",
    "src/db/": "db",
    "src/ops/": "ops",
    "src/": "app",
    "lib/": "lib",
    "app/": "frontend",
    "docs/": "docs",
    ".github/": "ci",
    "infra/": "infra",
    "packages/": "packages",
  },
  typeByLabel: {
    bug: "bugfix",
    bugfix: "bugfix",
    fix: "bugfix",
    feature: "feature",
    enhancement: "feature",
    dependencies: "dependency",
    dependency: "dependency",
    refactor: "refactor",
    docs: "docs",
    documentation: "docs",
  },
  typeByPath: {
    "package.json": "dependency",
    "pnpm-lock.yaml": "dependency",
    "yarn.lock": "dependency",
    "package-lock.json": "dependency",
    "bun.lockb": "dependency",
  },
  defaultChangeType: "feature",
};

export function sizeBucketFor(additions: number, deletions: number): SizeBucket {
  const lines = additions + deletions;
  if (lines < 20) return "xs";
  if (lines < 100) return "s";
  if (lines < 500) return "m";
  if (lines < 2_000) return "l";
  return "xl";
}

export function classifyChangeType(
  pull: Pick<SourcePull, "labels" | "files">,
  rules: ClassificationRules = DEFAULT_RULES,
): ChangeType {
  for (const file of pull.files) {
    const byPath = rules.typeByPath[file];
    if (byPath) return byPath;
  }
  for (const label of pull.labels) {
    const byLabel = rules.typeByLabel[label.toLowerCase()];
    if (byLabel) return byLabel;
  }
  return rules.defaultChangeType;
}

export function classifyArea(
  pull: Pick<SourcePull, "files">,
  rules: ClassificationRules = DEFAULT_RULES,
): string {
  let best: { prefix: string; area: string } | null = null;
  for (const file of pull.files) {
    for (const [prefix, area] of Object.entries(rules.areaByPrefix)) {
      if (file.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) {
        best = { prefix, area };
      }
    }
  }
  return best?.area ?? "unknown";
}

/** All review-timing / outcome metrics derived for a pull from its reviews. */
export function deriveReviewMetrics(
  pull: Pick<SourcePull, "number" | "createdAt">,
  reviews: readonly SourceReview[],
  comments: readonly SourceReviewComment[],
): Pick<
  PullRecord,
  | "firstHumanReviewAt"
  | "reviewCompletedAt"
  | "reviewHours"
  | "totalReviewHours"
  | "reviewOutcome"
  | "hadFindings"
  | "reviewCount"
  | "commentCount"
> {
  const reviewCount = reviews.length;
  const commentCount = comments.length;
  if (reviewCount === 0) {
    return {
      firstHumanReviewAt: null,
      reviewCompletedAt: null,
      reviewHours: null,
      totalReviewHours: null,
      reviewOutcome: "none",
      hadFindings: false,
      reviewCount: 0,
      commentCount,
    };
  }
  const sorted = [...reviews].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const reviewHours = hoursBetween(pull.createdAt, first.submittedAt);
  const totalReviewHours = hoursBetween(first.submittedAt, last.submittedAt);
  const reviewOutcome =
    last.state === "APPROVED"
      ? "approved"
      : last.state === "CHANGES_REQUESTED"
        ? "changes_requested"
        : "commented";
  return {
    firstHumanReviewAt: first.submittedAt,
    reviewCompletedAt: last.submittedAt,
    reviewHours,
    totalReviewHours,
    reviewOutcome,
    hadFindings: reviews.some((r) => r.state === "CHANGES_REQUESTED"),
    reviewCount,
    commentCount,
  };
}
