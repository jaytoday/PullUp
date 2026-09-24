// Ingest: PullSource → PullStore, through deterministic classification.
// Idempotent (upserts), paginated per source, offline-testable.

import type { PullRecord } from "../schema/domain.js";
import { parseRepoId } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";
import {
  classifyArea,
  classifyChangeType,
  deriveReviewMetrics,
  sizeBucketFor,
} from "./classify.js";
import type { PullSource } from "./source.js";
import { hunkContentHash } from "../signals/hunks.js";

export interface IngestResult {
  readonly repoId: string;
  readonly pulls: number;
  readonly reviews: number;
  readonly comments: number;
  readonly defects: number;
  readonly mergedPulls: number;
}

export interface IngestOptions {
  readonly repoId?: string;
  /** ISO timestamp stamped on the repository row (defaults to now). */
  readonly now?: string;
}

export async function ingestRepo(
  source: PullSource,
  store: PullStore,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const repoId = opts.repoId ?? source.repoId;
  const { owner, repo } = parseRepoId(repoId);
  const repoMeta = await source.readRepository();
  const now = opts.now ?? new Date().toISOString();
  await store.upsertRepository({
    repoId,
    owner: repoMeta.owner || owner,
    repo: repoMeta.repo || repo,
    defaultBranch: repoMeta.defaultBranch,
    ingestedAt: now,
  });

  const pulls = await source.listPulls();
  let reviews = 0;
  let comments = 0;
  let defects = 0;
  let mergedPulls = 0;

  for (const sp of pulls) {
    const pullReviews = await source.listReviews(sp.number);
    const pullComments = await source.listReviewComments(sp.number);
    const pullDefects = await source.listDefectEvents(sp.number);
    const metrics = deriveReviewMetrics(sp, pullReviews, pullComments);

    const pull: PullRecord = {
      repoId,
      number: sp.number,
      title: sp.title,
      author: sp.author,
      createdAt: sp.createdAt,
      closedAt: sp.closedAt,
      mergedAt: sp.mergedAt,
      state: sp.state,
      baseBranch: sp.baseBranch,
      headSha: sp.headSha,
      firstReviewRequestedAt: null,
      additions: sp.additions,
      deletions: sp.deletions,
      changedFiles: sp.changedFiles,
      labels: sp.labels,
      draft: sp.draft,
      files: sp.files,
      changeType: classifyChangeType(sp),
      area: classifyArea(sp),
      sizeBucket: sizeBucketFor(sp.additions, sp.deletions),
      defectProxy: pullDefects.length > 0 ? pullDefects[0]!.kind : null,
      ...metrics,
    };

    await store.upsertPull(pull);
    // Hunks are replaced wholesale when the source supplies them (a re-push can
    // drop hunks); sources without patches leave stored hunks untouched.
    if (sp.hunks) {
      await store.replaceHunks(
        repoId,
        sp.number,
        sp.hunks.map((h) => ({
          repoId,
          pullNumber: sp.number,
          path: h.path,
          index: h.index,
          header: h.header,
          patch: h.patch,
          noPatch: h.noPatch ?? false,
          contentHash: hunkContentHash(h),
        })),
      );
    }
    for (const r of pullReviews) {
      await store.upsertReview({ repoId, pullNumber: sp.number, ...r });
      reviews += 1;
    }
    for (const c of pullComments) {
      await store.upsertReviewComment({ repoId, pullNumber: sp.number, ...c });
      comments += 1;
    }
    for (const d of pullDefects) {
      await store.upsertDefectEvent({ repoId, pullNumber: sp.number, ...d });
      defects += 1;
    }
    if (sp.state === "merged") mergedPulls += 1;
  }

  return { repoId, pulls: pulls.length, reviews, comments, defects, mergedPulls };
}
