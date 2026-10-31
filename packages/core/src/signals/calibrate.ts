// Calibration against the repo's own labelled history. Labels: a merged PR is
// positive when it later shipped a defect proxy (revert/hotfix/follow-up/
// reopen). We fit the aggregate risk model (ridge logistic regression over the
// PR features, fixed-iteration IRLS — deterministic), measure it out-of-fold
// (AUROC / ECE / Brier), backtest realised two-cost outcomes vs rules-only, and
// apply a promotion gate. Only a passing artifact may move P_defect.
//
// Why no per-question Platt scaling: repo history has no ground truth for
// "does this hunk touch auth?", only for "did this PR ship a defect". The
// aggregate fit absorbs per-question scale and bias in its weights.

import { readFileSync } from "node:fs";
import { runAnalytics } from "../analytics/run.js";
import type { CostPriors } from "../config/config.js";
import { delayCost, findOptimalWait, defectProbability, reviewEfficacy } from "../cost/model.js";
import { assembleParams } from "../cost/params.js";
import type { PolicyRules } from "../policy/policy.js";
import { evaluatePolicy } from "../policy/policy.js";
import type { PullStore } from "../schema/store.js";
import { assessPull, extractFeatures, featureNames, monotoneFeature, riskFromFeatures } from "./aggregate.js";
import type { JevConfig, RiskWeights } from "./config.js";
import { sha256 } from "./hunks.js";
import { loadPullSignals } from "./run.js";
import type { QuestionSet } from "./types.js";

// ── metrics and fit (moved to @pullup/control; re-exported for existing callers) ──

import { adaptiveEce, auroc, brier, ece, fitLogistic, reliability } from "@pullup/control";
import type { ReliabilityBin } from "@pullup/control";
export { adaptiveEce, auroc, brier, ece, fitLogistic, reliability };
export type { FitOptions, ReliabilityBin } from "@pullup/control";

// ── artifact ───────────────────────────────────────────────────────────────

export interface GateCheck {
  readonly name: string;
  readonly value: number | null;
  readonly threshold: number;
  readonly passed: boolean;
}

export interface CalibrationArtifact {
  readonly kind: "pullup-jev-calibration";
  readonly version: 1;
  readonly repoId: string;
  readonly modelId: string;
  readonly questionSetVersion: string;
  readonly createdAt: string;
  readonly featureNames: readonly string[];
  readonly weights: RiskWeights;
  readonly labelled: { readonly merged: number; readonly withSignals: number; readonly defects: number };
  readonly metrics: {
    /** `ece` = adaptive (equal-mass, 10 bins) — the gated metric. */
    readonly fitted: { readonly auroc: number | null; readonly ece: number; readonly brier: number };
    readonly uncalibrated: { readonly auroc: number | null; readonly ece: number; readonly brier: number };
    readonly perFeatureAuroc: Readonly<Record<string, number | null>>;
    readonly reliability: readonly ReliabilityBin[];
  };
  readonly backtest: {
    readonly prs: number;
    readonly rulesOnlyCostHours: number;
    readonly withJevCostHours: number;
    readonly deltaHours: number;
  };
  readonly fastPath: { readonly eligible: number; readonly defects: number; readonly precision: number | null };
  /** Gates the (upward-only) risk multiplier. */
  readonly gate: { readonly passed: boolean; readonly checks: readonly GateCheck[] };
  /**
   * Gates the fast path separately: a real APPROVE needs this to pass plus
   * live delivery (see actions/approval.ts).
   */
  readonly fastPathGate: { readonly passed: boolean; readonly checks: readonly GateCheck[] };
  readonly hash: string;
}

export interface CalibrateOptions {
  readonly now?: string;
  readonly folds?: number;
  readonly policy: PolicyRules;
  readonly config: JevConfig;
}

function round(x: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

export async function calibrateRepo(
  store: PullStore,
  repoId: string,
  priors: CostPriors,
  qs: QuestionSet,
  modelId: string,
  opts: CalibrateOptions,
): Promise<CalibrationArtifact> {
  const now = opts.now ?? new Date().toISOString();
  const folds = opts.folds ?? 5;
  const analytics = await runAnalytics(store, repoId, priors);
  const params = assembleParams(analytics, priors);
  const names = featureNames(qs);
  // Risk features may only push risk up (monotonicity / asymmetric authority).
  const nonNegative = names.map((n) => monotoneFeature(n));

  const merged = (await store.listMergedPulls(repoId)).sort((a, b) => a.number - b.number);
  const rows: Array<{
    pull: (typeof merged)[number];
    x: number[];
    features: Record<string, number>;
    y: boolean;
    fastPath: boolean;
  }> = [];
  for (const pull of merged) {
    const signals = await loadPullSignals(store, pull, qs, modelId);
    const features = extractFeatures(signals, qs);
    if (!features) continue;
    const a = assessPull({
      pull,
      policy: evaluatePolicy(pull.files, opts.policy),
      signals,
      qs,
      config: opts.config,
      weights: opts.config.weights,
      calibrated: false,
      baseDefectProbability: defectProbability(params, pull.changeType),
    });
    rows.push({
      pull,
      x: names.map((n) => features[n] ?? 0),
      features,
      y: pull.defectProxy !== null,
      fastPath: a.fastPathEligible,
    });
  }

  const y = rows.map((r) => r.y);
  const defects = y.filter(Boolean).length;

  // Uncalibrated (config weights) baseline.
  const rawProbs = rows.map((r) => riskFromFeatures(r.features, opts.config.weights));

  // Out-of-fold predictions for honest metrics.
  const oof = new Array<number>(rows.length).fill(0);
  if (rows.length >= folds && defects > 0) {
    for (let f = 0; f < folds; f++) {
      const trainIdx = rows.map((_, i) => i).filter((i) => i % folds !== f);
      const beta = fitLogistic(
        trainIdx.map((i) => rows[i]!.x),
        trainIdx.map((i) => y[i]!),
        { nonNegative },
      );
      rows.forEach((r, i) => {
        if (i % folds !== f) return;
        let z = beta[0]!;
        r.x.forEach((v, k) => (z += beta[k + 1]! * v));
        oof[i] = 1 / (1 + Math.exp(-z));
      });
    }
  } else {
    rawProbs.forEach((p, i) => (oof[i] = p));
  }

  const beta =
    rows.length > 0 ? fitLogistic(rows.map((r) => r.x), y, { nonNegative }) : [opts.config.weights.intercept];
  const weights: RiskWeights = {
    intercept: round(beta[0]!, 6),
    features: Object.fromEntries(names.map((n, k) => [n, round(beta[k + 1] ?? 0, 6)])),
  };

  const perFeatureAuroc: Record<string, number | null> = {};
  names.forEach((n, k) => {
    const a = auroc(rows.map((r) => r.x[k]!), y);
    perFeatureAuroc[n] = a === null ? null : round(a);
  });

  // Backtest: realised two-cost outcome under rules-only w* vs Jev-raised w*.
  const cDefect = params.defectReworkHours * params.escalationMultiplier;
  let rulesOnly = 0;
  let withJev = 0;
  rows.forEach((r, i) => {
    const type = r.pull.changeType;
    const base = defectProbability(params, type);
    const m = Math.min(opts.config.multiplierMax, Math.max(1, oof[i]! / Math.max(base, 1e-9)));
    const wA = findOptimalWait(params, type);
    const wB = findOptimalWait(params, type, base * m);
    const realised = (w: number) =>
      delayCost(w, params) + (r.y ? cDefect * (1 - reviewEfficacy(w, params)) : 0);
    rulesOnly += realised(wA);
    withJev += realised(wB);
  });

  const fpRows = rows.filter((r) => r.fastPath);
  const fpDefects = fpRows.filter((r) => r.y).length;
  const fpPrecision = fpRows.length > 0 ? (fpRows.length - fpDefects) / fpRows.length : null;

  const fitted = { auroc: auroc(oof, y), ece: adaptiveEce(oof, y), brier: brier(oof, y) };
  const g = opts.config.gate;
  const checks: GateCheck[] = [
    { name: "merged PRs with signals", value: rows.length, threshold: g.minMerged, passed: rows.length >= g.minMerged },
    { name: "defect-labelled PRs", value: defects, threshold: g.minDefects, passed: defects >= g.minDefects },
    { name: "out-of-fold AUROC", value: fitted.auroc === null ? null : round(fitted.auroc), threshold: g.minAuroc, passed: (fitted.auroc ?? 0) >= g.minAuroc },
    { name: "out-of-fold adaptive ECE", value: round(fitted.ece), threshold: g.maxEce, passed: fitted.ece <= g.maxEce },
    {
      name: "backtest cost ≤ rules-only (dev-hours)",
      value: round(withJev - rulesOnly, 2),
      threshold: 0,
      passed: withJev <= rulesOnly + 1e-9,
    },
  ];
  const fastPathChecks: GateCheck[] = [
    {
      name: "fast-path eligible merged PRs",
      value: fpRows.length,
      threshold: 1,
      passed: fpRows.length >= 1,
    },
    {
      name: "fast-path precision (no later defect)",
      value: fpPrecision === null ? null : round(fpPrecision),
      threshold: g.minFastPathPrecision,
      passed: fpPrecision !== null && fpPrecision >= g.minFastPathPrecision,
    },
  ];

  const body: Omit<CalibrationArtifact, "hash"> = {
    kind: "pullup-jev-calibration",
    version: 1,
    repoId,
    modelId,
    questionSetVersion: qs.version,
    createdAt: now,
    featureNames: names,
    weights,
    labelled: { merged: merged.length, withSignals: rows.length, defects },
    metrics: {
      fitted: { auroc: fitted.auroc === null ? null : round(fitted.auroc), ece: round(fitted.ece), brier: round(fitted.brier) },
      uncalibrated: (() => {
        const a = auroc(rawProbs, y);
        return { auroc: a === null ? null : round(a), ece: round(adaptiveEce(rawProbs, y)), brier: round(brier(rawProbs, y)) };
      })(),
      perFeatureAuroc,
      reliability: reliability(oof, y).map((b) => ({
        ...b,
        meanPredicted: b.meanPredicted === null ? null : round(b.meanPredicted),
        observedRate: b.observedRate === null ? null : round(b.observedRate),
      })),
    },
    backtest: {
      prs: rows.length,
      rulesOnlyCostHours: round(rulesOnly, 2),
      withJevCostHours: round(withJev, 2),
      deltaHours: round(withJev - rulesOnly, 2),
    },
    fastPath: { eligible: fpRows.length, defects: fpDefects, precision: fpPrecision === null ? null : round(fpPrecision) },
    gate: { passed: checks.every((c) => c.passed), checks },
    fastPathGate: { passed: fastPathChecks.every((c) => c.passed), checks: fastPathChecks },
  };
  return { ...body, hash: sha256(JSON.stringify(body)).slice(0, 16) };
}

export function loadCalibration(path: string): CalibrationArtifact {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as CalibrationArtifact;
  if (parsed.kind !== "pullup-jev-calibration" || parsed.version !== 1) {
    throw new Error(`${path} is not a PullUp Jev calibration artifact.`);
  }
  const { hash, ...body } = parsed;
  if (sha256(JSON.stringify(body)).slice(0, 16) !== hash) {
    throw new Error(`Calibration artifact ${path} failed its integrity hash (edited by hand?).`);
  }
  return parsed;
}
