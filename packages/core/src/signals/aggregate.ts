// Aggregation: per-unit answers → PR features → risk → band + P_defect
// multiplier. All composition happens here, in code, with weights we own.
//
// Asymmetric authority: signals may always *raise* risk (m ≥ 1, escalate,
// review-with-rationale). They never lower it — fast-path eligibility is
// computed and logged (the would-be approval), but m < 1 is never applied.

import type { PullRecord } from "../schema/domain.js";
import type { PolicyResult } from "../policy/policy.js";
import type { JevConfig, RiskWeights } from "./config.js";
import type { ChoiceAnswer, NoulAnswer, QuestionSet, ScoreAnswer, SignalUnit, UnitAnswers } from "./types.js";
import { evaluable } from "./units.js";

export type Band = "fast-path" | "standard" | "review-with-rationale" | "escalate";

export interface PullSignals {
  readonly pullNumber: number;
  readonly units: readonly SignalUnit[];
  /** Aligned with `units`; null = not evaluated (not evaluable, uncached, or failed). */
  readonly answers: ReadonlyArray<UnitAnswers | null>;
}

export interface TopSignal {
  readonly question: string;
  readonly p: number;
  readonly unitKey: string;
}

export interface RiskAssessment {
  readonly pullNumber: number;
  readonly band: Band;
  /** Aggregate P(defect) from the risk model, null when no unit was evaluated. */
  readonly risk: number | null;
  /** The P_defect multiplier actually applied (≥ 1; 1 unless calibrated). */
  readonly multiplier: number;
  /** What m would be with both directions allowed (logged, never applied below 1). */
  readonly unclampedMultiplier: number | null;
  readonly calibrated: boolean;
  readonly fastPathEligible: boolean;
  readonly fastPathBlockers: readonly string[];
  readonly escalateReasons: readonly string[];
  readonly reviewReasons: readonly string[];
  readonly topSignals: readonly TopSignal[];
  readonly policy: PolicyResult;
  readonly unitsTotal: number;
  readonly unitsEvaluated: number;
}

const EPS = 1e-4;

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function logit(p: number): number {
  const q = Math.min(1 - EPS, Math.max(EPS, p));
  return Math.log(q / (1 - q));
}

function noul(a: UnitAnswers, id: string): number | null {
  const x = a.answers[id];
  return x && x.kind === "noul" ? (x as NoulAnswer).p : null;
}

/** Feature names in a fixed order (the calibration design matrix columns). */
export function featureNames(qs: QuestionSet): string[] {
  return [
    ...qs.sensitive.map((q) => `max:${q}`),
    `max:${qs.injection}`,
    "blastMax",
    "lowRiskMin",
    "logUnits",
  ];
}

/** PR-level features from evaluated units, or null when none were evaluated. */
export function extractFeatures(ps: PullSignals, qs: QuestionSet): Record<string, number> | null {
  const evaluated = ps.answers.filter((a): a is UnitAnswers => a !== null);
  if (evaluated.length === 0) return null;
  const f: Record<string, number> = {};
  for (const q of [...qs.sensitive, qs.injection]) {
    f[`max:${q}`] = Math.max(...evaluated.map((a) => noul(a, q) ?? 0));
  }
  const blastSpec = qs.questions[qs.blastRadius];
  const levels = blastSpec && blastSpec.kind === "score" ? blastSpec.levels.length : 2;
  f.blastMax = Math.max(
    ...evaluated.map((a) => {
      const s = a.answers[qs.blastRadius] as ScoreAnswer | undefined;
      return s ? s.score / (levels - 1) : 0;
    }),
  );
  // Per unit: strongest low-risk evidence; PR-level: the weakest unit.
  f.lowRiskMin = Math.min(
    ...evaluated.map((a) => Math.max(...qs.lowRisk.map((q) => noul(a, q) ?? 0))),
  );
  f.logUnits = Math.log1p(evaluated.length);
  return f;
}

/**
 * Features that may only raise risk: every `max:` signal (sensitive questions
 * and the injection tripwire) and blast radius. Their weights are clamped to
 * ≥ 0 wherever they come from, so a stronger risk signal can never lower risk.
 */
export function monotoneFeature(name: string): boolean {
  return name.startsWith("max:") || name === "blastMax";
}

export function riskFromFeatures(features: Record<string, number>, w: RiskWeights): number {
  let z = w.intercept;
  for (const [name, weight] of Object.entries(w.features)) {
    const effective = monotoneFeature(name) ? Math.max(0, weight) : weight;
    z += effective * (features[name] ?? 0);
  }
  return sigmoid(z);
}

export interface AssessInput {
  readonly pull: Pick<PullRecord, "number" | "files">;
  readonly policy: PolicyResult;
  readonly signals: PullSignals;
  readonly qs: QuestionSet;
  readonly config: JevConfig;
  /** Weights from a passing calibration, else config weights (uncalibrated). */
  readonly weights: RiskWeights;
  readonly calibrated: boolean;
  /** The repo's shrunk P_defect for this PR's change type. */
  readonly baseDefectProbability: number;
}

export function assessPull(input: AssessInput): RiskAssessment {
  const { policy, signals, qs, config } = input;
  const t = config.thresholds;
  const escalateReasons: string[] = [];
  const reviewReasons: string[] = [];
  const fastPathBlockers: string[] = [];

  for (const hit of policy.hits) escalateReasons.push(`policy: ${hit.rule} (${hit.path})`);

  const unitsTotal = signals.units.length;
  const unitsEvaluated = signals.answers.filter((a) => a !== null).length;
  const notEvaluable = signals.units.filter((u) => !evaluable(u));
  if (notEvaluable.length > 0) {
    reviewReasons.push(
      `${notEvaluable.length} unit(s) not evaluable (${notEvaluable.some((u) => u.noPatch) ? "no patch" : "oversize"})`,
    );
  }
  const missing = signals.units.filter((u, i) => evaluable(u) && signals.answers[i] === null).length;
  if (missing > 0) reviewReasons.push(`${missing} unit(s) not yet evaluated`);
  if (unitsTotal === 0) fastPathBlockers.push("no diff hunks");
  if (unitsEvaluated < unitsTotal) fastPathBlockers.push("not every unit evaluated");

  const top: TopSignal[] = [];
  signals.answers.forEach((a, i) => {
    if (!a) return;
    const unitKey = signals.units[i]!.key;
    for (const q of qs.sensitive) {
      const p = noul(a, q) ?? 0;
      top.push({ question: q, p, unitKey });
      if (p >= t.sensitiveHigh && qs.escalating.includes(q)) {
        escalateReasons.push(`signal: ${q} p=${p.toFixed(2)} (${unitKey})`);
      } else if (p >= t.sensitiveMedium) {
        reviewReasons.push(`signal: ${q} p=${p.toFixed(2)} (${unitKey})`);
      }
      if (p >= t.fastPathMaxRisk) fastPathBlockers.push(`${q} p=${p.toFixed(2)} (${unitKey})`);
    }
    const inj = noul(a, qs.injection) ?? 0;
    top.push({ question: qs.injection, p: inj, unitKey });
    if (inj >= t.injection) escalateReasons.push(`injection tripwire p=${inj.toFixed(2)} (${unitKey})`);
    if (inj >= t.fastPathMaxRisk) fastPathBlockers.push(`${qs.injection} p=${inj.toFixed(2)} (${unitKey})`);

    const kind = a.answers[qs.changeKind] as ChoiceAnswer | undefined;
    if (!kind || !qs.lowRiskKinds.includes(kind.choice) || kind.confidence < t.fastPathMinConfidence) {
      fastPathBlockers.push(
        `changeKind ${kind ? `${kind.choice}@${kind.confidence.toFixed(2)}` : "missing"} (${unitKey})`,
      );
    }
  });

  if (policy.requiresHuman) fastPathBlockers.push("policy requires a human");
  if (policy.category === null) {
    // Outside the path allowlist, only formatting-only evidence can qualify.
    const formattingOnly = signals.answers.every(
      (a) => a !== null && (noul(a, "isFormattingOnly") ?? 0) >= t.fastPathMinLowRisk,
    );
    if (!formattingOnly) fastPathBlockers.push("not in an allowlisted category (docs/test/formatting)");
  }

  const features = extractFeatures(signals, qs);
  const risk = features ? riskFromFeatures(features, input.weights) : null;
  const base = input.baseDefectProbability;
  const raw = risk !== null && base > 0 ? risk / base : null;
  const unclampedMultiplier =
    raw === null ? null : Math.min(config.multiplierMax, Math.max(config.multiplierMin, raw));
  // Only calibrated risk may move P_defect, and only upward.
  const multiplier =
    input.calibrated && unclampedMultiplier !== null ? Math.max(1, unclampedMultiplier) : 1;

  const fastPathEligible = fastPathBlockers.length === 0;
  const band: Band =
    escalateReasons.length > 0
      ? "escalate"
      : reviewReasons.length > 0
        ? "review-with-rationale"
        : fastPathEligible
          ? "fast-path"
          : "standard";

  return {
    pullNumber: input.pull.number,
    band,
    risk,
    multiplier,
    unclampedMultiplier,
    calibrated: input.calibrated,
    fastPathEligible,
    fastPathBlockers: dedupe(fastPathBlockers).slice(0, 8),
    escalateReasons: dedupe(escalateReasons),
    reviewReasons: dedupe(reviewReasons),
    topSignals: top
      .filter((s) => s.p >= 0.05)
      .sort((a, b) => b.p - a.p || a.unitKey.localeCompare(b.unitKey))
      .slice(0, 3),
    policy,
    unitsTotal,
    unitsEvaluated,
  };
}

function dedupe(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}
