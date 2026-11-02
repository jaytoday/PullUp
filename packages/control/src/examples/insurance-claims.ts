// Example: straight-through processing for small property and auto claims.
//
// A claim is "bad" when paying it without review would have been wrong:
// overpaid, later reopened, or found to be fraudulent. The model learns from
// past claims; an adjuster sees everything it is not sure about.
//
// The synthetic generator below stands in for a claims system export so the
// whole pipeline can be run offline (`pnpm control:demo`). Its `group` field
// is a stand-in for a protected trait, used only by the fairness check and
// never as a model feature.

import type { FeatureSpec, LabelledCase } from "../calibration.js";
import type { CaseCosts } from "../cost.js";
import type { ReasonTable } from "../reasons.js";

export const CLAIM_FEATURES: readonly FeatureSpec[] = [
  { name: "amountLog", riskSignal: true },
  { name: "earlyClaim", riskSignal: true },
  { name: "priorClaims", riskSignal: true },
  { name: "documentsMissing", riskSignal: true },
  { name: "bodilyInjury", riskSignal: true },
  { name: "glassOnly" },
];

export const CLAIM_REASONS: ReasonTable = {
  amountLog: "The claimed amount is higher than typical for this coverage.",
  earlyClaim: "The loss happened within 30 days of the policy starting.",
  priorClaims: "The policyholder has several recent prior claims.",
  documentsMissing: "Required documents (photos, estimate, police report) are missing.",
  bodilyInjury: "The claim involves a bodily injury.",
  glassOnly: "The claim is glass-only.",
  possibleFraud: "An automated review flagged patterns associated with fraud.",
  possibleExclusion: "An automated policy review found wording that may exclude this loss.",
};

export interface ClaimRecord extends LabelledCase {
  readonly amount: number;
  readonly group: string;
  readonly coverage: "auto-glass" | "auto-collision" | "property-water" | "property-theft";
}

export interface ClaimGeneratorOptions {
  readonly count: number;
  readonly seed?: number;
  /** Make group "B" claims more likely to be missing documents (to see the fairness gate fail). */
  readonly skewGroupB?: boolean;
}

/** Small deterministic random generator (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COVERAGES = ["auto-glass", "auto-collision", "property-water", "property-theft"] as const;
const BASE_AMOUNT: Record<ClaimRecord["coverage"], number> = {
  "auto-glass": 450,
  "auto-collision": 3200,
  "property-water": 6500,
  "property-theft": 2100,
};

export function claimFeatures(c: {
  readonly amount: number;
  readonly daysSincePolicyStart: number;
  readonly priorClaims: number;
  readonly documentsMissing: number;
  readonly bodilyInjury: boolean;
  readonly coverage: ClaimRecord["coverage"];
}): Record<string, number> {
  return {
    amountLog: Math.log10(Math.max(1, c.amount)) - 3,
    earlyClaim: c.daysSincePolicyStart < 30 ? 1 : 0,
    priorClaims: c.priorClaims,
    documentsMissing: c.documentsMissing,
    bodilyInjury: c.bodilyInjury ? 1 : 0,
    glassOnly: c.coverage === "auto-glass" ? 1 : 0,
  };
}

export function generateClaims(opts: ClaimGeneratorOptions): ClaimRecord[] {
  const rand = seededRandom(opts.seed ?? 7);
  const out: ClaimRecord[] = [];
  for (let i = 0; i < opts.count; i++) {
    const coverage = COVERAGES[Math.floor(rand() * COVERAGES.length)]!;
    const group = rand() < 0.5 ? "A" : "B";
    const amount = Math.round(BASE_AMOUNT[coverage] * Math.exp((rand() - 0.5) * 1.6));
    const daysSincePolicyStart = Math.floor(rand() * 720);
    const priorClaims = rand() < 0.75 ? 0 : rand() < 0.7 ? 1 : 2 + Math.floor(rand() * 3);
    const missingChance = opts.skewGroupB && group === "B" ? 0.55 : 0.2;
    const documentsMissing = rand() < missingChance ? 1 + Math.floor(rand() * 2) : 0;
    const bodilyInjury = coverage === "auto-collision" && rand() < 0.2;
    const features = claimFeatures({ amount, daysSincePolicyStart, priorClaims, documentsMissing, bodilyInjury, coverage });
    const z =
      -3.9 +
      1.1 * features.amountLog! +
      1.6 * features.earlyClaim! +
      0.6 * features.priorClaims! +
      0.8 * features.documentsMissing! +
      1.2 * features.bodilyInjury! -
      0.8 * features.glassOnly!;
    const bad = rand() < 1 / (1 + Math.exp(-z));
    out.push({ id: `CLM-${String(i + 1).padStart(5, "0")}`, features, bad, amount, group, coverage });
  }
  return out;
}

/** Costs for deciding one claim. Leakage on a wrongly paid claim is taken as 60% of the amount. */
export function claimCosts(amount: number): CaseCosts {
  return { handlingCost: 85, delayCostPerDay: 25, reviewDays: 3, lossIfWrong: amount * 0.6 };
}
