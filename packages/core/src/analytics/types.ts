// The typed outputs of the analytics engine. Every bucket carries `n` so thin
// data is visible, never silently confident.

import type { LatencyStats } from "./stats.js";

export interface LatencyReport {
  readonly timeToFirstReviewHours: LatencyStats;
  readonly totalReviewHours: LatencyStats;
  readonly waitHours: LatencyStats;
  readonly byArea: Readonly<Record<string, LatencyStats>>;
  readonly byContributor: Readonly<Record<string, LatencyStats>>;
  readonly bySize: Readonly<Record<string, LatencyStats>>;
}

export interface OutcomeBucket {
  /** Lower edge of the wait-hours bucket. */
  readonly bucketHours: number;
  readonly n: number;
  readonly approvals: number;
  readonly changesRequested: number;
  readonly commented: number;
  readonly approvalRate: number | null;
  readonly changesRequestedRate: number | null;
  readonly shippedDefectRate: number | null;
}

export interface OutcomesReport {
  readonly buckets: readonly OutcomeBucket[];
  readonly approvalVsWaitCorrelation: number | null;
  readonly changesRequestedVsWaitCorrelation: number | null;
}

export interface DefectRate {
  readonly n: number;
  readonly defects: number;
  readonly rate: number | null;
}

export interface DefectReport {
  readonly overall: DefectRate;
  readonly byChangeType: Readonly<Record<string, DefectRate>>;
  readonly byArea: Readonly<Record<string, DefectRate>>;
}

export interface EfficacyReport {
  readonly withFindings: DefectRate;
  readonly withoutFindings: DefectRate;
  /** Fraction of ship-risk review removes at full review (0..1), 0 when unmeasurable. */
  readonly eMax: number;
}

export interface CongestionPoint {
  readonly day: string;
  readonly openPullsAwaitingReview: number;
  readonly activeReviewers: number;
  readonly queueDepth: number;
  readonly meanResponseHours: number | null;
}

export interface CongestionReport {
  readonly points: readonly CongestionPoint[];
  readonly current: CongestionPoint | null;
  readonly meanQueueDepth: number | null;
}

export interface AnalyticsReport {
  readonly repoId: string;
  readonly pullCount: number;
  readonly mergedCount: number;
  readonly reviewedCount: number;
  readonly latency: LatencyReport;
  readonly outcomes: OutcomesReport;
  readonly defects: DefectReport;
  readonly efficacy: EfficacyReport;
  readonly congestion: CongestionReport;
}
