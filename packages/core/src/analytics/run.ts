// The analytics entry point: compute the full empirical report for a repo.

import type { CostPriors } from "../config/config.js";
import type { PullStore } from "../schema/store.js";
import { congestionReport } from "./congestion.js";
import { defectReport } from "./defects.js";
import { efficacyReport } from "./efficacy.js";
import { latencyReport } from "./latency.js";
import { outcomesReport } from "./outcomes.js";
import type { AnalyticsReport } from "./types.js";

export async function runAnalytics(
  store: PullStore,
  repoId: string,
  priors: CostPriors,
): Promise<AnalyticsReport> {
  const pulls = await store.listPulls(repoId);
  const reviews = await store.listReviews(repoId);
  const mergedCount = pulls.filter((p) => p.state === "merged").length;
  const reviewedCount = pulls.filter((p) => p.reviewCount > 0).length;

  return {
    repoId,
    pullCount: pulls.length,
    mergedCount,
    reviewedCount,
    latency: latencyReport(pulls),
    outcomes: outcomesReport(pulls),
    defects: defectReport(pulls),
    efficacy: efficacyReport(pulls, priors),
    congestion: congestionReport(pulls, reviews),
  };
}
