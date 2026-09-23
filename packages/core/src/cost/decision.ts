// The decision rule: given a pull's wait so far and its features, and the
// assembled per-repo CostParams, what would the system do?
//
//   request-changes — a blocking human finding, or net value is negative
//   review-complete  — already merged/closed, or a human already approved
//   auto-approve     — wait ≥ w*: further review no longer pays
//   keep-reviewing   — wait < w*: review still pays
//
// The walking skeleton recommends, it does not enforce (enforcement is a
// follow-up phase).

import { hoursBetween } from "../schema/domain.js";
import type { PullRecord, ReviewRecord, ReviewState } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";
import {
  delayCost,
  expectedDefectCost,
  findOptimalWait,
  marginalDelayCost,
  marginalReviewBenefit,
} from "./model.js";
import type { CostParams } from "./params.js";

export type Recommendation =
  | "auto-approve"
  | "keep-reviewing"
  | "request-changes"
  | "review-complete";

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
): PullDecision {
  const w = waitSoFar(pull, now);
  const maxWaitHours = findOptimalWait(params, pull.changeType);
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
    expectedDefectCost: Math.round(expectedDefectCost(w, params, pull.changeType) * 100) / 100,
    marginalDelayPerHour: Math.round(marginalDelayCost(params) * 1000) / 1000,
    marginalReviewBenefitPerHour: Math.round(
      marginalReviewBenefit(w, params, pull.changeType) * 1000,
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

  const E = expectedDefectCost(w, params, pull.changeType);
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
): Promise<PullDecision[]> {
  const pulls = await store.listPulls(repoId);
  const reviews = await store.listReviews(repoId);
  const byPull = new Map<number, ReviewRecord[]>();
  for (const r of reviews) {
    const list = byPull.get(r.pullNumber);
    if (list) list.push(r);
    else byPull.set(r.pullNumber, [r]);
  }
  return pulls.map((p) => decideOne(p, byPull.get(p.number) ?? [], params, now));
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
    else summary.reviewComplete += 1;
  }
  return summary;
}
