// The Two-Cost Model (TCM).
//
//   D(w) = r_v·w + Δ_ctx·[w > T_cold] + r_conflict·w·h_conflict   (delay cost)
//   E(w) = P_defect(x) · (1 − e(x,w)) · C_defect(x)               (expected defect cost)
//   e(x,w) = e_max(x) · (1 − e^(−w/T_review))                     (review efficacy so far)
//
// The optimal approval time w* minimizes F(w) = D(w) + E(w). E is convex and
// decreasing, D is linear up to the cold-start step, so F is unimodal and a
// monotone-safe grid scan finds w*. The marginal curves are reported for
// transparency: approve when the marginal delay cost meets or exceeds the
// marginal expected defect-cost reduction.
//
// All costs are dev-hours.

import type { ChangeType } from "../schema/domain.js";
import type { CostParams } from "./params.js";

/** Cumulative delay cost of waiting `w` hours, in dev-hours. */
export function delayCost(w: number, p: CostParams): number {
  const base = p.valueDelayRatePerHour * w;
  const cold = w > p.coldStartThresholdHours ? p.coldStartCostHours : 0;
  const conflict = p.conflictRatePerHour * w * p.conflictResolutionHours;
  return base + cold + conflict;
}

/** Marginal delay cost D'(w) — the linear rate terms (cold start is a step). */
export function marginalDelayCost(p: CostParams): number {
  return p.valueDelayRatePerHour + p.conflictRatePerHour * p.conflictResolutionHours;
}

/** Review efficacy so far: e_max × g(w/T_review), g(t) = 1 − e^(−t). */
export function reviewEfficacy(w: number, p: CostParams): number {
  const t = w / p.reviewWindowHours;
  return p.eMax * (1 - Math.exp(-t));
}

function defectCost(p: CostParams, type: ChangeType): number {
  return p.defectReworkHours * p.escalationMultiplier;
}

export function defectProbability(p: CostParams, type: ChangeType): number {
  return p.baseDefectProbability[type] ?? p.defaultDefectProbability;
}

/**
 * Expected defect cost if approved at wait `w`, in dev-hours. `pDefect`
 * overrides the per-type probability with a per-PR one (Jev risk layer).
 */
export function expectedDefectCost(
  w: number,
  p: CostParams,
  type: ChangeType,
  pDefect?: number,
): number {
  const pd = pDefect ?? defectProbability(p, type);
  const cd = defectCost(p, type);
  return pd * (1 - reviewEfficacy(w, p)) * cd;
}

/** Marginal expected defect-cost reduction of another unit of review, −E'(w). */
export function marginalReviewBenefit(
  w: number,
  p: CostParams,
  type: ChangeType,
  pDefect?: number,
): number {
  const pd = pDefect ?? defectProbability(p, type);
  const cd = defectCost(p, type);
  const t = w / p.reviewWindowHours;
  return ((pd * p.eMax * cd) / p.reviewWindowHours) * Math.exp(-t);
}

/** Total expected cost F(w) = D(w) + E(w). */
export function totalCost(w: number, p: CostParams, type: ChangeType, pDefect?: number): number {
  return delayCost(w, p) + expectedDefectCost(w, p, type, pDefect);
}

/**
 * The optimal approval wait w* = argmin F(w), in hours. Grid scan at 1-hour
 * resolution between minWait and the cap — deterministic and monotone-safe.
 */
export function findOptimalWait(p: CostParams, type: ChangeType, pDefect?: number): number {
  const step = 1;
  let best = p.minWaitHours;
  let bestCost = totalCost(best, p, type, pDefect);
  for (let w = p.minWaitHours + step; w <= p.maxWaitHoursCap; w += step) {
    const c = totalCost(w, p, type, pDefect);
    if (c < bestCost) {
      bestCost = c;
      best = w;
    }
  }
  return best;
}

export interface CostCurvePoint {
  /** Wait in hours. */
  readonly w: number;
  /** Cumulative delay cost D(w). */
  readonly D: number;
  /** Expected defect cost E(w). */
  readonly E: number;
  /** Total F(w) = D(w) + E(w). */
  readonly F: number;
}

/** Samples D, E, F over [0, maxHours] — what the UI plots, from the engine's own math. */
export function costCurve(
  p: CostParams,
  type: ChangeType,
  maxHours: number,
  opts: { readonly pDefect?: number; readonly points?: number } = {},
): CostCurvePoint[] {
  const n = Math.max(2, opts.points ?? 96);
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return Array.from({ length: n + 1 }, (_, i) => {
    const w = (maxHours * i) / n;
    const D = delayCost(w, p);
    const E = expectedDefectCost(w, p, type, opts.pDefect);
    return { w: round(w), D: round(D), E: round(E), F: round(D + E) };
  });
}
