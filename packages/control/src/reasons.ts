// Plain-language reasons for a decision.
//
// When a claim is denied or reduced, or an applicant declined, the person is
// usually owed the main reasons. With a logistic model, a feature's push on
// this case is its weight × (its value − the typical value); the largest
// upward pushes are the reasons. Only features with a positive weight whose
// value is above typical count: a feature that lowers risk ("glass only")
// being absent is not a reason anyone can act on. Each feature maps to a sentence in a reason
// table so nothing technical reaches the notice.

import type { FeatureSpec } from "./calibration.js";
import type { RiskSignal } from "./risk.js";

export interface ReasonTable {
  readonly [feature: string]: string;
}

export interface Reason {
  readonly feature: string;
  readonly text: string;
  /** How much this pushed the risk up, in log-odds (for ordering only). */
  readonly push: number;
}

export function topReasons(
  model: { readonly beta: readonly number[]; readonly features: readonly FeatureSpec[] },
  caseFeatures: Readonly<Record<string, number>>,
  typical: Readonly<Record<string, number>>,
  table: ReasonTable,
  opts: { readonly limit?: number; readonly signals?: readonly RiskSignal[] } = {},
): Reason[] {
  const fromModel: Reason[] = model.features
    .map((f, k) => {
      const weight = model.beta[k + 1] ?? 0;
      const above = (caseFeatures[f.name] ?? 0) - (typical[f.name] ?? 0);
      return { feature: f.name, text: table[f.name] ?? f.name, push: weight > 0 && above > 0 ? weight * above : 0 };
    })
    .filter((r) => r.push > 0);
  const fromSignals: Reason[] = (opts.signals ?? [])
    .filter((s) => s.probability > 0)
    .map((s) => ({ feature: `signal:${s.name}`, text: s.reason ?? table[s.name] ?? s.name, push: Math.log(1 / Math.max(1e-6, 1 - s.probability)) }));
  return [...fromModel, ...fromSignals].sort((a, b) => b.push - a.push || a.feature.localeCompare(b.feature)).slice(0, opts.limit ?? 4);
}

/** Mean of each feature over a set of cases — the "typical" baseline. */
export function typicalValues(cases: readonly { readonly features: Readonly<Record<string, number>> }[], names: readonly string[]): Record<string, number> {
  return Object.fromEntries(names.map((n) => [n, cases.length ? cases.reduce((s, c) => s + (c.features[n] ?? 0), 0) / cases.length : 0]));
}
