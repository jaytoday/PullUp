// Assembles the concrete, per-repo parameters the two-cost model runs on:
// measured values from the analytics report shrunk toward the named priors.
// Every parameter carries provenance so the report can show what was measured
// vs assumed.

import type { AnalyticsReport } from "../analytics/types.js";
import type { CostPriors } from "../config/config.js";
import { shrunkRate } from "../analytics/stats.js";
import type { ChangeType } from "../schema/domain.js";

export const CHANGE_TYPES: readonly ChangeType[] = [
  "feature",
  "bugfix",
  "dependency",
  "refactor",
  "docs",
  "other",
];

export interface ParamProvenance {
  readonly source: "measured" | "prior";
  readonly n?: number;
}

export interface CostParams {
  readonly repoId: string;
  /** r_v, congestion-inflated: value lost per hour of wait, in dev-hours. */
  readonly valueDelayRatePerHour: number;
  readonly coldStartThresholdHours: number;
  readonly coldStartCostHours: number;
  readonly conflictRatePerHour: number;
  readonly conflictResolutionHours: number;
  readonly escalationMultiplier: number;
  /** C_defect baseline rework (dev-hours) before the escalation multiplier. */
  readonly defectReworkHours: number;
  /** Shrunk P(defect) per change type. */
  readonly baseDefectProbability: Readonly<Record<ChangeType, number>>;
  readonly defaultDefectProbability: number;
  /** e_max: review efficacy at full review, congestion-damped. */
  readonly eMax: number;
  /** T_review: the hour-scale on which efficacy saturates. */
  readonly reviewWindowHours: number;
  /** Value of a change (dev-hours) per type — the net-value reject branch. */
  readonly changeValueHours: Readonly<Record<ChangeType, number>>;
  readonly defaultChangeValueHours: number;
  /** κ — current queue depth (open awaiting ÷ active reviewers). */
  readonly congestionQueueDepth: number;
  readonly maxWaitHoursCap: number;
  readonly minWaitHours: number;
  readonly provenance: Readonly<Record<string, ParamProvenance>>;
}

export function assembleParams(repo: AnalyticsReport, priors: CostPriors): CostParams {
  const kappa = repo.congestion.current?.queueDepth ?? 1;

  const valueDelayRatePerHour =
    priors.valueDelayRatePerHour *
    (1 + priors.delayCongestionWeight * Math.max(0, kappa - 1));

  const rawEMax = repo.efficacy.eMax;
  const eMax =
    rawEMax > 0 ? rawEMax / (1 + priors.efficacyCongestionWeight * kappa) : rawEMax;

  // Per-type shrinkage toward each type's own prior (falling back to the
  // overall rate anchor), so thin per-type samples stay plausible instead of
  // collapsing to 0 or spiking on noise.
  const overall = repo.defects.overall;
  const overallRate = shrunkRate(
    overall.defects,
    overall.n,
    priors.defectPrior,
    priors.defectPriorWeight,
  );

  const baseDefectProbability = {} as Record<ChangeType, number>;
  for (const type of CHANGE_TYPES) {
    const r = repo.defects.byChangeType[type];
    const count = r?.defects ?? 0;
    const n = r?.n ?? 0;
    const anchor = priors.defectPriorByType[type] ?? overallRate;
    baseDefectProbability[type] = shrunkRate(count, n, anchor, priors.typeDefectPriorWeight);
  }

  const provenance: Record<string, ParamProvenance> = {
    valueDelayRatePerHour: { source: "prior" },
    coldStartThresholdHours: { source: "prior" },
    coldStartCostHours: { source: "prior" },
    conflictRatePerHour: { source: "prior" },
    conflictResolutionHours: { source: "prior" },
    escalationMultiplier: { source: "prior" },
    defectReworkHours: { source: "prior" },
    baseDefectProbability: {
      source: "measured",
      n: repo.defects.overall.n,
    },
    eMax: {
      source: repo.efficacy.withFindings.n + repo.efficacy.withoutFindings.n > 0
        ? "measured"
        : "prior",
      n: repo.efficacy.withFindings.n + repo.efficacy.withoutFindings.n,
    },
    reviewWindowHours: { source: "prior" },
    congestionQueueDepth: { source: "measured" },
  };

  return {
    repoId: repo.repoId,
    valueDelayRatePerHour,
    coldStartThresholdHours: priors.coldStartThresholdHours,
    coldStartCostHours: priors.coldStartCostHours,
    conflictRatePerHour: priors.conflictRatePerWeek / (7 * 24),
    conflictResolutionHours: priors.conflictResolutionHours,
    escalationMultiplier: priors.escalationMultiplier,
    defectReworkHours: priors.defectReworkHours,
    baseDefectProbability,
    defaultDefectProbability: priors.defectPrior,
    eMax,
    reviewWindowHours: priors.reviewWindowHours,
    changeValueHours: priors.changeValueHoursByType,
    defaultChangeValueHours: priors.defaultChangeValueHours,
    congestionQueueDepth: kappa,
    maxWaitHoursCap: priors.maxWaitHoursCap,
    minWaitHours: priors.minWaitHours,
    provenance,
  };
}
