// Deterministic synthetic-repo generation for offline fixtures and tests.
// Seeded PRNG ⇒ the same options produce byte-identical fixtures every run.
//
// The generator builds a FixtureFile (nested pulls × reviews × comments ×
// defect events) that `FixtureSource` serves through the PullSource seam.
// Defect proxies correlate with review findings so efficacy has a signal.

import { addHours, hoursBetween } from "../schema/domain.js";
import type { ChangeType, ReviewState, SizeBucket } from "../schema/domain.js";
import type {
  FixtureFile,
  PullSource,
  SourceDefectEvent,
  SourcePull,
  SourceRepo,
  SourceReview,
  SourceReviewComment,
} from "../ingest/source.js";

export interface GenerateOptions {
  readonly seed?: number;
  readonly n?: number;
  readonly days?: number;
  readonly now?: string;
  readonly defectPrior?: number;
  /** "healthy" reviews land in ~4–48h; "congested" in ~24–168h. */
  readonly policy?: "healthy" | "congested";
  /** Repo name (defaults to the policy name). */
  readonly repoName?: string;
}

const AREAS = ["api", "core", "db", "ops"] as const;
const AUTHORS = ["alice", "bob", "carol", "dave", "erin"] as const;
const REVIEWERS = ["frank", "grace", "heidi", "ivan", "judy"] as const;
const THINGS = ["auth", "billing", "search", "cache", "scheduler", "notifications"] as const;
const FIX_SUFFIXES: ReadonlyArray<SourceDefectEvent["kind"]> = [
  "hotfix",
  "revert",
  "followup_fix",
  "reopen",
];

export interface GeneratedPull {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly changeType: ChangeType;
  readonly area: string;
  readonly sizeBucket: SizeBucket;
  readonly createdAt: string;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly state: SourcePull["state"];
  readonly hadFindings: boolean;
  readonly firstReviewAt: string;
  readonly reviews: SourceReview[];
  readonly comments: SourceReviewComment[];
  readonly defectEvents: SourceDefectEvent[];
}

export interface GeneratedRepo {
  readonly repo: SourceRepo;
  readonly pulls: GeneratedPull[];
}

/** mulberry32 — small, fast, deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length)]!;
}

function pickWeighted<T>(rand: () => number, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

function changeTypeOf(rand: () => number): ChangeType {
  return pickWeighted(rand, [
    ["feature", 40],
    ["bugfix", 30],
    ["refactor", 15],
    ["dependency", 10],
    ["docs", 5],
  ] as const);
}

/** Files + labels that make classifyChangeType / classifyArea return the intent. */
function filesAndLabelsFor(changeType: ChangeType, area: string): {
  files: string[];
  labels: string[];
} {
  switch (changeType) {
    case "dependency":
      return { files: ["package.json", "pnpm-lock.yaml"], labels: [] };
    case "docs":
      return { files: ["docs/guide.md"], labels: ["documentation"] };
    case "bugfix":
      return { files: [`src/${area}/fix.ts`, `src/${area}/index.ts`], labels: ["bug"] };
    case "refactor":
      return { files: [`src/${area}/impl.ts`], labels: ["refactor"] };
    default:
      return { files: [`src/${area}/feature.ts`, `src/${area}/index.ts`], labels: ["enhancement"] };
  }
}

function findingsProbability(changeType: ChangeType): number {
  switch (changeType) {
    case "feature":
    case "bugfix":
      return 0.35;
    case "refactor":
      return 0.18;
    case "dependency":
      return 0.1;
    default:
      return 0.05;
  }
}

function bucketHours(policy: "healthy" | "congested"): readonly [number, number] {
  return policy === "healthy" ? [4, 48] : [24, 168];
}

export function generateRepo(options: GenerateOptions = {}): GeneratedRepo {
  const rand = mulberry32(options.seed ?? 42);
  const n = options.n ?? 40;
  const days = options.days ?? 90;
  const now = options.now ?? new Date().toISOString();
  const defectPrior = options.defectPrior ?? 0.15;
  const policy = options.policy ?? "healthy";
  const [minH, maxH] = bucketHours(policy);

  const repo: SourceRepo = { owner: "fixtures", repo: options.repoName ?? policy, defaultBranch: "main" };
  const pulls: GeneratedPull[] = [];

  for (let i = 0; i < n; i++) {
    const number = i + 1;
    const changeType = changeTypeOf(rand);
    const area = pick(rand, AREAS);
    const author = pick(rand, AUTHORS);
    const additions = Math.floor(rand() * 500);
    const deletions = Math.floor(rand() * additions * 0.5);
    const sizeBucket: SizeBucket =
      additions < 20 ? "xs" : additions < 100 ? "s" : additions < 500 ? "m" : "l";
    const title = `Add ${pick(rand, THINGS)} ${changeType}`;

    const isOpen = rand() < 0.2;
    const isClosed = !isOpen && rand() < 0.08;
    const state: SourcePull["state"] = isOpen ? "open" : isClosed ? "closed" : "merged";

    // Open PRs skew recent (rand()² pulls toward 0): freshly-opened PRs are the
    // realistic population the decision rule acts on. Merged/closed stay uniform.
    const createdAt = isOpen || isClosed
      ? addHours(now, -(rand() ** 2) * 21 * 24)
      : addHours(now, -rand() * days * 24);
    const firstReviewHours = minH + rand() * (maxH - minH);
    const firstReviewAt = addHours(createdAt, firstReviewHours);

    const pFind = findingsProbability(changeType);
    const hadFindings = rand() < pFind;
    // Open PRs are still awaiting action: never hand them an APPROVED review.
    const reviewCount = hadFindings ? (state === "merged" ? 2 : 1) : 1;

    const reviews: SourceReview[] = [];
    const comments: SourceReviewComment[] = [];

    // First (or only) review. If findings: changes-requested or commented w/ inline comment.
    const reviewerA = pick(rand, REVIEWERS);
    const idSeed = number * 1000;
    if (hadFindings) {
      // Findings always land as CHANGES_REQUESTED so the derived hadFindings
      // metric (any CHANGES_REQUESTED review) matches the generator's intent.
      reviews.push({
        id: idSeed + 1,
        author: reviewerA,
        submittedAt: firstReviewAt,
        state: "CHANGES_REQUESTED",
        body: "Found a couple of things before this is shippable.",
      });
      comments.push({
        id: idSeed + 2,
        author: reviewerA,
        createdAt: firstReviewAt,
        path: `src/${area}/index.ts`,
        body: `Potential issue here — double-check the ${area} edge case.`,
      });
      // Author addresses findings, reviewer approves — unless the findings were
      // never resolved (PR merged anyway). The latter keeps the final
      // review-state signal (CHANGES_REQUESTED) visible to outcome analytics.
      const resolved = rand() < 0.6;
      if ((state === "merged" || state === "closed") && resolved) {
        const fixHours = 6 + rand() * 66;
        const secondAt = addHours(firstReviewAt, fixHours);
        reviews.push({
          id: idSeed + 3,
          author: pick(rand, REVIEWERS),
          submittedAt: secondAt,
          state: "APPROVED",
          body: "Looks good now.",
        });
      }
    } else {
      reviews.push({
        id: idSeed + 1,
        author: reviewerA,
        submittedAt: firstReviewAt,
        state: state === "open" ? "COMMENTED" : rand() < 0.75 ? "APPROVED" : "COMMENTED",
        body: "LGTM",
      });
      if (rand() < 0.15) {
        comments.push({
          id: idSeed + 2,
          author: reviewerA,
          createdAt: firstReviewAt,
          path: `src/${area}/index.ts`,
          body: "Minor: could reuse the helper here.",
        });
      }
    }

    const lastReviewAt = reviews[reviews.length - 1]!.submittedAt;
    const mergedAt =
      state === "merged"
        ? addHours(lastReviewAt, hadFindings ? 6 + rand() * 48 : 2 + rand() * 12)
        : null;
    const closedAt = state === "closed" ? addHours(lastReviewAt, 2 + rand() * 24) : null;

    // Defect proxy: findings caught in review cut ship-risk sharply.
    let defectEvents: SourceDefectEvent[] = [];
    if (state === "merged") {
      const pDefect = hadFindings ? defectPrior * 0.35 : defectPrior * 1.4;
      if (rand() < pDefect) {
        defectEvents = [
          {
            kind: FIX_SUFFIXES[Math.floor(rand() * FIX_SUFFIXES.length)]!,
            at: addHours(mergedAt!, 24 + rand() * 14 * 24),
            detail: `${pick(rand, THINGS)} regression`,
          },
        ];
      }
    }

    pulls.push({
      number,
      title,
      author,
      changeType,
      area,
      sizeBucket,
      createdAt,
      mergedAt,
      closedAt,
      state,
      hadFindings,
      firstReviewAt,
      reviews,
      comments,
      defectEvents,
    });
  }

  return { repo, pulls };
}

/** Wraps a GeneratedRepo as a PullSource so ingest can consume it directly. */
export class FixtureSource implements PullSource {
  readonly repoId: string;

  constructor(
    private readonly generated: GeneratedRepo,
    repoIdOverride?: string,
  ) {
    this.repoId =
      repoIdOverride ?? `${generated.repo.owner}/${generated.repo.repo}`;
  }

  async readRepository(): Promise<SourceRepo> {
    return this.generated.repo;
  }

  async listPulls(): Promise<SourcePull[]> {
    return this.generated.pulls.map((p) => toSourcePull(p));
  }

  async listReviews(pullNumber: number): Promise<SourceReview[]> {
    return this.generated.pulls.find((p) => p.number === pullNumber)?.reviews ?? [];
  }

  async listReviewComments(pullNumber: number): Promise<SourceReviewComment[]> {
    return this.generated.pulls.find((p) => p.number === pullNumber)?.comments ?? [];
  }

  async listDefectEvents(pullNumber: number): Promise<SourceDefectEvent[]> {
    return this.generated.pulls.find((p) => p.number === pullNumber)?.defectEvents ?? [];
  }
}

function toSourcePull(p: GeneratedPull): SourcePull {
  const { files, labels } = filesAndLabelsFor(p.changeType, p.area);
  return {
    number: p.number,
    title: p.title,
    author: p.author,
    createdAt: p.createdAt,
    closedAt: p.closedAt ?? null,
    mergedAt: p.mergedAt,
    state: p.state,
    baseBranch: "main",
    headSha: `deadbeef${String(p.number).padStart(8, "0")}`,
    additions: sizeLinesFor(p.sizeBucket, p.changeType),
    deletions: Math.floor(sizeLinesFor(p.sizeBucket, p.changeType) * 0.4),
    changedFiles: files.length,
    labels,
    draft: false,
    files,
  };
}

function sizeLinesFor(bucket: SizeBucket, _changeType: ChangeType): number {
  switch (bucket) {
    case "xs":
      return 8;
    case "s":
      return 50;
    case "m":
      return 250;
    case "l":
      return 1000;
    default:
      return 200;
  }
}

/** Serialize a GeneratedRepo to a FixtureFile JSON document. */
export function toFixtureFile(g: GeneratedRepo): FixtureFile {
  return {
    repo: g.repo,
    pulls: g.pulls.map((p) => ({
      ...toSourcePull(p),
      reviews: p.reviews,
      reviewComments: p.comments,
      defectEvents: p.defectEvents,
    })),
  };
}

/** Convenience: actual wait hours across generated merged PRs. */
export function mergedWaitHours(g: GeneratedRepo, now: string): number[] {
  return g.pulls
    .filter((p) => p.state === "merged")
    .map((p) => hoursBetween(p.createdAt, p.mergedAt!));
}
