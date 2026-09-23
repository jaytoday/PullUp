// The decision rule: given a pull's wait so far and its features, and the
// assembled per-repo CostParams, what would the system do?
//
//   request-changes — a blocking human finding, or net value is negative
//   review-complete  — already merged/closed, or a human already approved
//   escalate         — (Jev layer, active mode) policy hit or high-risk signal:
//                      a human must review; beats every model-driven branch
//   auto-approve     — wait ≥ w*: further review no longer pays
//   keep-reviewing   — wait < w*: review still pays
//
// The walking skeleton recommends, it does not enforce (enforcement is a
// follow-up phase). Bot review actions are planned and logged only — see
// actions/review.ts.

import { hoursBetween } from "../schema/domain.js";
import type { PullRecord, ReviewRecord, ReviewState } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";
import {
  defectProbability,
  delayCost,
  expectedDefectCost,
  findOptimalWait,
  marginalDelayCost,
  marginalReviewBenefit,
} from "./model.js";
import type { CostParams } from "./params.js";
import type { Band, RiskAssessment, TopSignal } from "../signals/aggregate.js";

export type Recommendation =
  | "auto-approve"
  | "keep-reviewing"
  | "request-changes"
  | "review-complete"
  | "escalate";

/** Jev risk-layer overlay on a decision (absent when the layer is off). */
export interface DecisionRisk {
  readonly mode: "shadow" | "active";
  readonly band: Band;
  readonly riskScore: number | null;
  /** P_defect multiplier applied in active mode (always ≥ 1). */
  readonly multiplier: number;
  readonly calibrated: boolean;
  readonly pDefect: number;
  /** Logged would-be approval: fast-path eligible (never lowers risk). */
  readonly fastPathEligible: boolean;
  readonly needsRationale: boolean;
  readonly escalateReasons: readonly string[];
  readonly reviewReasons: readonly string[];
  readonly topSignals: readonly TopSignal[];
  /** Shadow mode only: what active mode would have done. */
  readonly shadowRecommendation?: Recommendation;
  readonly shadowMaxWaitHours?: number;
}

export interface RiskOverlay {
  readonly mode: "shadow" | "active";
  readonly assessment: RiskAssessment;
}

export interface PullDecision {
  readonly pullNumber: number;
  readonly title: string;
  readonly changeType: string;
  readonly area: string;
  readonly author: string;
  readonly state: PullRecord["state"];
  readonly waitHours: number;
  readonly maxWaitHours: number;
  readonly delayCost: number;
  readonly expectedDefectCost: number;
  readonly marginalDelayPerHour: number;
  readonly marginalReviewBenefitPerHour: number;
  readonly lastReviewState: ReviewState | null;
  readonly recommendation: Recommendation;
  readonly reason: string;
  readonly risk?: DecisionRisk;
}

function lastReviewState(reviews: readonly ReviewRecord[]): ReviewState | null {
  if (reviews.length === 0) return null;
  const sorted = [...reviews].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  return sorted[sorted.length - 1]!.state;
}

function waitSoFar(pull: PullRecord, now: string): number {
  const end = pull.mergedAt ?? pull.closedAt;
  return hoursBetween(pull.createdAt, end ?? now);
}

function changeValue(p: CostParams, type: string): number {
  return p.changeValueHours[type as keyof CostParams["changeValueHours"]] ?? p.defaultChangeValueHours;
}

export function decideOne(
  pull: PullRecord,
  reviews: readonly ReviewRecord[],
  params: CostParams,
  now: string,
  overlay?: RiskOverlay,
): PullDecision {
  if (!overlay) return decideCore(pull, reviews, params, now);
  const a = overlay.assessment;
  const pDefect = defectProbability(params, pull.changeType) * a.multiplier;
  const escalate = a.band === "escalate";
  const activeDecision = decideCore(pull, reviews, params, now, { pDefect, escalate });
  const risk: DecisionRisk = {
    mode: overlay.mode,
    band: a.band,
    riskScore: a.risk === null ? null : Math.round(a.risk * 10_000) / 10_000,
    multiplier: Math.round(a.multiplier * 1000) / 1000,
    calibrated: a.calibrated,
    pDefect: Math.round(pDefect * 10_000) / 10_000,
    fastPathEligible: a.fastPathEligible,
    needsRationale: a.band === "escalate" || a.band === "review-with-rationale",
    escalateReasons: a.escalateReasons,
    reviewReasons: a.reviewReasons,
    topSignals: a.topSignals,
  };
  if (overlay.mode === "active") return { ...activeDecision, risk };
  // Shadow: the decision is exactly the layer-off decision; the active outcome
  // is recorded alongside for comparison.
  const offDecision = decideCore(pull, reviews, params, now);
  return {
    ...offDecision,
    risk: {
      ...risk,
      shadowRecommendation: activeDecision.recommendation,
      shadowMaxWaitHours: activeDecision.maxWaitHours,
    },
  };
}

interface CoreOverride {
  readonly pDefect: number;
  readonly escalate: boolean;
}

function decideCore(
  pull: PullRecord,
  reviews: readonly ReviewRecord[],
  params: CostParams,
  now: string,
  override?: CoreOverride,
): PullDecision {
  const pd = override?.pDefect;
  const w = waitSoFar(pull, now);
  const maxWaitHours = findOptimalWait(params, pull.changeType, pd);
  const lastState = lastReviewState(reviews);

  const base: Omit<PullDecision, "recommendation" | "reason"> = {
    pullNumber: pull.number,
    title: pull.title,
    changeType: pull.changeType,
    area: pull.area,
    author: pull.author,
    state: pull.state,
    waitHours: Math.round(w * 100) / 100,
    maxWaitHours,
    delayCost: Math.round(delayCost(w, params) * 100) / 100,
    expectedDefectCost: Math.round(expectedDefectCost(w, params, pull.changeType, pd) * 100) / 100,
    marginalDelayPerHour: Math.round(marginalDelayCost(params) * 1000) / 1000,
    marginalReviewBenefitPerHour: Math.round(
      marginalReviewBenefit(w, params, pull.changeType, pd) * 1000,
    ) / 1000,
    lastReviewState: lastState,
  };

  if (pull.state === "merged" || pull.state === "closed") {
    return {
      ...base,
      recommendation: "review-complete",
      reason: pull.state === "merged" ? "Already merged." : "Closed without merging.",
    };
  }

  if (lastState === "CHANGES_REQUESTED") {
    return {
      ...base,
      recommendation: "request-changes",
      reason: "Blocking finding: a human review requested changes; re-review is needed.",
    };
  }
  if (lastState === "APPROVED") {
    return {
      ...base,
      recommendation: "review-complete",
      reason: "Human approved; no system decision needed.",
    };
  }

  if (override?.escalate) {
    return {
      ...base,
      recommendation: "escalate",
      reason: "Escalated to a human: policy rule or high-risk signal (see risk reasons).",
    };
  }

  const E = expectedDefectCost(w, params, pull.changeType, pd);
  const D = delayCost(w, params);
  const V = changeValue(params, pull.changeType);

  if (V - E - D < 0) {
    return {
      ...base,
      recommendation: "request-changes",
      reason:
        `Net value negative: value ${V}h < wait cost ${D.toFixed(1)}h + expected defect cost ${E.toFixed(1)}h.`,
    };
  }
  if (w >= maxWaitHours) {
    return {
      ...base,
      recommendation: "auto-approve",
      reason:
        `At hour ${base.waitHours}h ≥ max-wait ${maxWaitHours}h: further review no longer pays ` +
        `(marginal delay ${base.marginalDelayPerHour} ≥ marginal review benefit ${base.marginalReviewBenefitPerHour}).`,
    };
  }
  return {
    ...base,
    recommendation: "keep-reviewing",
    reason:
      `At hour ${base.waitHours}h < max-wait ${maxWaitHours}h: review still pays ` +
      `(marginal benefit ${base.marginalReviewBenefitPerHour} > marginal delay ${base.marginalDelayPerHour}).`,
  };
}

export async function decideForRepo(
  store: PullStore,
  repoId: string,
  params: CostParams,
  now: string,
  overlays?: ReadonlyMap<number, RiskOverlay>,
): Promise<PullDecision[]> {
  const pulls = await store.listPulls(repoId);
  const reviews = await store.listReviews(repoId);
  const byPull = new Map<number, ReviewRecord[]>();
  for (const r of reviews) {
    const list = byPull.get(r.pullNumber);
    if (list) list.push(r);
    else byPull.set(r.pullNumber, [r]);
  }
  return pulls.map((p) =>
    decideOne(p, byPull.get(p.number) ?? [], params, now, overlays?.get(p.number)),
  );
}

/** Per-repo summary counts over open (undecided-by-human) pulls. */
export function summarizeDecisions(decisions: readonly PullDecision[]): {
  readonly autoApprove: number;
  readonly keepReviewing: number;
  readonly requestChanges: number;
  readonly reviewComplete: number;
} {
  const summary = { autoApprove: 0, keepReviewing: 0, requestChanges: 0, reviewComplete: 0 };
  for (const d of decisions) {
    if (d.recommendation === "auto-approve") summary.autoApprove += 1;
    else if (d.recommendation === "keep-reviewing") summary.keepReviewing += 1;
    else if (d.recommendation === "request-changes") summary.requestChanges += 1;
    // Escalations are counted in the report's risk summary (keeps this shape
    // identical when the Jev layer is off).
    else if (d.recommendation === "review-complete") summary.reviewComplete += 1;
  }
  return summary;
}
