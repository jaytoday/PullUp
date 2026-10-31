// Fairness checks before a model may decide anything on its own.
//
// Insurance regulators (for example Colorado's rules on insurers' use of
// outside data and models, and New York's circular letter on AI in
// underwriting and pricing) expect a company to test whether a model treats
// groups of people unfairly. Two common tests:
//
// - Adverse impact ratio: each group's favorable-outcome rate divided by the
//   best-off group's rate. Below 0.8 is the usual warning line (the
//   "four-fifths rule" from US employment practice).
// - Calibration by group: a predicted 10% risk should mean about 10% in every
//   group. A large gap in calibration error between groups fails.
//
// The group label is a protected trait or an approved stand-in for one. It is
// used here only to test the model, never as a model feature.
//
// Fails closed: a group too small to measure fails the gate rather than
// being skipped.

import { adaptiveEce, gate, type Gate, type GateCheck } from "./calibration.js";
import { round } from "./canonical.js";

export interface FairnessCase {
  readonly group: string;
  /** The model's (out-of-fold) predicted risk. */
  readonly risk: number;
  /** What actually happened (true = bad outcome). */
  readonly bad: boolean;
}

export interface FairnessOptions {
  /** Risk at or below this gets the favorable outcome (automatic approval). */
  readonly favorableMaxRisk: number;
  /** Minimum adverse impact ratio (default 0.8). */
  readonly minImpactRatio?: number;
  /** Largest allowed gap in calibration error between groups (default 0.05). */
  readonly maxCalibrationGap?: number;
  /** Cases per group needed to measure it (default 30). */
  readonly minGroupSize?: number;
}

export interface GroupStats {
  readonly group: string;
  readonly n: number;
  readonly favorableRate: number;
  readonly badRate: number;
  readonly calibrationError: number;
}

export interface FairnessReport {
  readonly groups: readonly GroupStats[];
  readonly impactRatio: number | null;
  readonly calibrationGap: number | null;
  readonly gate: Gate;
}

export function fairnessReport(cases: readonly FairnessCase[], opts: FairnessOptions): FairnessReport {
  const minRatio = opts.minImpactRatio ?? 0.8;
  const maxGap = opts.maxCalibrationGap ?? 0.05;
  const minN = opts.minGroupSize ?? 30;

  const byGroup = new Map<string, FairnessCase[]>();
  for (const c of cases) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);

  const groups: GroupStats[] = [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, rows]) => ({
      group,
      n: rows.length,
      favorableRate: round(rows.filter((r) => r.risk <= opts.favorableMaxRisk).length / rows.length),
      badRate: round(rows.filter((r) => r.bad).length / rows.length),
      calibrationError: round(adaptiveEce(rows.map((r) => r.risk), rows.map((r) => r.bad), 5)),
    }));

  const checks: GateCheck[] = [];
  for (const g of groups) {
    checks.push({ name: `group "${g.group}" size`, value: g.n, threshold: minN, passed: g.n >= minN });
  }
  checks.push({ name: "groups measured", value: groups.length, threshold: 2, passed: groups.length >= 2 });

  const best = Math.max(0, ...groups.map((g) => g.favorableRate));
  const worst = Math.min(...groups.map((g) => g.favorableRate));
  const impactRatio = groups.length >= 2 && best > 0 ? round(worst / best) : null;
  checks.push({ name: "adverse impact ratio", value: impactRatio, threshold: minRatio, passed: impactRatio !== null && impactRatio >= minRatio });

  const errs = groups.map((g) => g.calibrationError);
  const calibrationGap = groups.length >= 2 ? round(Math.max(...errs) - Math.min(...errs)) : null;
  checks.push({ name: "calibration gap between groups", value: calibrationGap, threshold: maxGap, passed: calibrationGap !== null && calibrationGap <= maxGap });

  return { groups, impactRatio, calibrationGap, gate: gate(checks) };
}
