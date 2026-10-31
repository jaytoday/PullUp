// The two-cost rule for one case: act on it now, or send it to a person?
//
//   cost of review     = handling cost + delay cost (per day waited × days)
//   cost of acting now = P(bad outcome) × loss if wrong
//
// Send to a person when review is cheaper than the expected loss. The
// break-even probability (review cost ÷ loss if wrong) turns this into a
// threshold anyone can read: "auto-pay a $900 glass claim only when the
// chance it is wrong is under 4%". All amounts are in one currency.
//
// This is the single-decision form of PullUp's two-cost model, which instead
// finds how long to wait; for most insurance work the question is yes or no.

import { round } from "./canonical.js";

export interface CaseCosts {
  /** Cost of a person handling it (adjuster or underwriter time). */
  readonly handlingCost: number;
  /** Cost per day of delay (customer experience, rental car days, lost quote). */
  readonly delayCostPerDay: number;
  /** Expected days a person takes. */
  readonly reviewDays: number;
  /** Loss if acting without review turns out wrong (leakage, fraud paid, a bad risk bound). */
  readonly lossIfWrong: number;
}

export interface CostComparison {
  readonly reviewCost: number;
  readonly expectedLossIfActed: number;
  readonly breakEvenRisk: number;
  /** "act" when acting now is cheaper; the authorizer still decides whether it may. */
  readonly cheaper: "act" | "review";
}

export function reviewCost(c: CaseCosts): number {
  return c.handlingCost + c.delayCostPerDay * c.reviewDays;
}

export function breakEvenRisk(c: CaseCosts): number {
  if (c.lossIfWrong <= 0) return 1;
  return Math.min(1, reviewCost(c) / c.lossIfWrong);
}

export function compareCosts(risk: number, c: CaseCosts): CostComparison {
  const rc = reviewCost(c);
  const el = risk * c.lossIfWrong;
  return {
    reviewCost: round(rc, 2),
    expectedLossIfActed: round(el, 2),
    breakEvenRisk: round(breakEvenRisk(c)),
    cheaper: el < rc ? "act" : "review",
  };
}
