// PullUp priors — the named, configurable inputs to the two-cost model.
//
// Every prior is either literature/heuristic-derived (documented inline) or
// user-set via `pullup.config.json`. Repo-measured parameters are shrunk toward
// these (see cost/params.ts) so thin data never produces false confidence.
// All durations are in hours; defect probabilities are 0..1 rates.

import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ChangeType } from "../schema/domain.js";

export interface CostPriors {
  /** r_v — value lost (dev-hours) per hour this change's merge is delayed. */
  readonly valueDelayRatePerHour: number;
  /** T_cold — wait after which the author pays a cold-start re-orientation cost. */
  readonly coldStartThresholdHours: number;
  /** Δ_ctx — the cold-start cost itself, in dev-hours. */
  readonly coldStartCostHours: number;
  /** Expected merge-conflict probability per week of wait (0..1). */
  readonly conflictRatePerWeek: number;
  /** Dev-hours to resolve a merge conflict once it happens. */
  readonly conflictResolutionHours: number;
  /** Defect cost multiplier: caught in production vs at review (1:10:100 prior). */
  readonly escalationMultiplier: number;
  /** Prior dev-hours of rework a shipped defect causes (measured from repo when possible). */
  readonly defectReworkHours: number;
  /** Prior base defect probability for an unknown change type. */
  readonly defectPrior: number;
  /** Prior base defect probability per change type (repo data shrinks toward these). */
  readonly defectPriorByType: Readonly<Record<ChangeType, number>>;
  /** Pseudo-count k for Bayesian shrinkage of measured defect rates. */
  readonly defectPriorWeight: number;
  /** Pseudo-count for per-type shrinkage toward its type prior. */
  readonly typeDefectPriorWeight: number;
  /** T_review — the hour-scale on which review efficacy saturates (g(w) = 1 − e^(−w/T)). */
  readonly reviewWindowHours: number;
  /** Prior review efficacy (fraction of ship-risk review removes at full review). */
  readonly efficacyPrior: number;
  /** Pseudo-count for efficacy shrinkage. */
  readonly efficacyPriorWeight: number;
  /** Days after merge we look back for defect proxies (revert/hotfix/follow-up fix/reopen). */
  readonly defectProxyWindowDays: number;
  /** How strongly queue depth κ inflates the value-delay rate: r_v_eff = r_v·(1 + k·(κ−1)). */
  readonly delayCongestionWeight: number;
  /** How strongly queue depth κ damps review efficacy: e_max_eff = e_max/(1 + k·κ). */
  readonly efficacyCongestionWeight: number;
  /** Prior value of a change (dev-hours), per type. Feeds the net-value reject branch. */
  readonly changeValueHoursByType: Readonly<Record<ChangeType, number>>;
  /** Value fallback for types missing from changeValueHoursByType. */
  readonly defaultChangeValueHours: number;
  /** Hard cap on w* (hours) — never recommend waiting past this. */
  readonly maxWaitHoursCap: number;
  /** Floor on w* (hours) — never auto-approve instantly. */
  readonly minWaitHours: number;
}

export const DEFAULT_PRIORS: CostPriors = {
  valueDelayRatePerHour: 0.1,
  coldStartThresholdHours: 24,
  coldStartCostHours: 2,
  conflictRatePerWeek: 0.2,
  conflictResolutionHours: 1.5,
  escalationMultiplier: 15,
  defectReworkHours: 8,
  defectPrior: 0.05,
  defectPriorByType: {
    feature: 0.06,
    bugfix: 0.08,
    dependency: 0.03,
    refactor: 0.05,
    docs: 0.01,
    other: 0.05,
  },
  defectPriorWeight: 20,
  typeDefectPriorWeight: 15,
  reviewWindowHours: 24,
  efficacyPrior: 0.5,
  efficacyPriorWeight: 10,
  defectProxyWindowDays: 14,
  delayCongestionWeight: 0.15,
  efficacyCongestionWeight: 0.1,
  changeValueHoursByType: {
    feature: 24,
    bugfix: 16,
    dependency: 8,
    refactor: 8,
    docs: 2,
    other: 4,
  },
  defaultChangeValueHours: 8,
  maxWaitHoursCap: 24 * 21,
  minWaitHours: 1,
};

const changeTypeSchema = z.enum(["feature", "bugfix", "dependency", "refactor", "docs", "other"]);

/** Validated partial priors as accepted by `pullup.config.json`. */
export const configFileSchema = z
  .object({
    valueDelayRatePerHour: z.number().min(0).optional(),
    coldStartThresholdHours: z.number().min(0).optional(),
    coldStartCostHours: z.number().min(0).optional(),
    conflictRatePerWeek: z.number().min(0).max(1).optional(),
    conflictResolutionHours: z.number().min(0).optional(),
    escalationMultiplier: z.number().min(1).optional(),
    defectReworkHours: z.number().min(0).optional(),
    defectPrior: z.number().min(0).max(1).optional(),
    defectPriorByType: z
      .record(changeTypeSchema, z.number().min(0).max(1))
      .optional(),
    defectPriorWeight: z.number().min(0).optional(),
    typeDefectPriorWeight: z.number().min(0).optional(),
    reviewWindowHours: z.number().min(0).optional(),
    efficacyPrior: z.number().min(0).max(1).optional(),
    efficacyPriorWeight: z.number().min(0).optional(),
    defectProxyWindowDays: z.number().min(1).optional(),
    delayCongestionWeight: z.number().min(0).optional(),
    efficacyCongestionWeight: z.number().min(0).optional(),
    changeValueHoursByType: z
      .record(changeTypeSchema, z.number().min(0))
      .optional(),
    defaultChangeValueHours: z.number().min(0).optional(),
    maxWaitHoursCap: z.number().min(0).optional(),
    minWaitHours: z.number().min(0).optional(),
  })
  .strict();

export type ConfigFile = z.infer<typeof configFileSchema>;

export function resolvePriors(file: ConfigFile = {}): CostPriors {
  const changeValueHoursByType = {
    ...DEFAULT_PRIORS.changeValueHoursByType,
    ...file.changeValueHoursByType,
  };
  const defectPriorByType = {
    ...DEFAULT_PRIORS.defectPriorByType,
    ...file.defectPriorByType,
  };
  return {
    ...DEFAULT_PRIORS,
    ...file,
    changeValueHoursByType,
    defectPriorByType,
  };
}

export interface ResolvedConfig {
  readonly priors: CostPriors;
  readonly path: string | null;
  /** Human-readable list of fields that came from the file. */
  readonly fileOverrides: readonly string[];
}

/** Loads priors from an optional `pullup.config.json`. Absent file → defaults. */
export function loadConfig(path?: string): ResolvedConfig {
  const resolvedPath = path ?? "pullup.config.json";
  let file: ConfigFile = {};
  let fileOverrides: string[] = [];
  try {
    const raw = readFileSync(resolvedPath, "utf8");
    const parsed = configFileSchema.parse(JSON.parse(raw));
    file = parsed;
    fileOverrides = Object.keys(parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { priors: resolvePriors(), path: null, fileOverrides: [] };
    }
    throw new Error(`Invalid pullup config at ${resolvedPath}: ${(err as Error).message}`);
  }
  return { priors: resolvePriors(file), path: resolvedPath, fileOverrides };
}
