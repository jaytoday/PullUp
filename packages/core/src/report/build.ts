// Assembles the full typed PullUp report: analytics + cost params + decisions.

import type { AnalyticsReport } from "../analytics/types.js";
import type { CostPriors } from "../config/config.js";
import { decideForRepo, summarizeDecisions } from "../cost/decision.js";
import type { PullDecision } from "../cost/decision.js";
import { assembleParams } from "../cost/params.js";
import type { CostParams } from "../cost/params.js";
import type { PullStore } from "../schema/store.js";
import { runAnalytics } from "../analytics/run.js";

export interface PullupReport {
  readonly repoId: string;
  readonly generatedAt: string;
  readonly configPath: string | null;
  readonly pulls: { total: number; merged: number; reviewed: number };
  readonly analytics: AnalyticsReport;
  readonly params: CostParams;
  readonly decisions: readonly PullDecision[];
  readonly summary: {
    readonly meanMaxWaitHours: number | null;
    readonly p50MaxWaitHours: number | null;
    readonly congestionQueueDepth: number | null;
    readonly counts: ReturnType<typeof summarizeDecisions>;
  };
}

export interface BuildReportOptions {
  readonly now?: string;
  readonly configPath?: string | null;
}

export async function buildReport(
  store: PullStore,
  repoId: string,
  priors: CostPriors,
  opts: BuildReportOptions = {},
): Promise<PullupReport> {
  const now = opts.now ?? new Date().toISOString();
  const analytics = await runAnalytics(store, repoId, priors);
  const params = assembleParams(analytics, priors);
  const decisions = await decideForRepo(store, repoId, params, now);

  const maxWaits = decisions.map((d) => d.maxWaitHours);
  const sorted = [...maxWaits].sort((a, b) => a - b);
  const meanMaxWaitHours =
    sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
  const p50MaxWaitHours = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] ?? null : null;

  return {
    repoId,
    generatedAt: now,
    configPath: opts.configPath ?? null,
    pulls: {
      total: analytics.pullCount,
      merged: analytics.mergedCount,
      reviewed: analytics.reviewedCount,
    },
    analytics,
    params,
    decisions,
    summary: {
      meanMaxWaitHours,
      p50MaxWaitHours,
      congestionQueueDepth: analytics.congestion.current?.queueDepth ?? null,
      counts: summarizeDecisions(decisions),
    },
  };
}
