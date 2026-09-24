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

// ── metrics ────────────────────────────────────────────────────────────────

/** Rank-based AUROC (Mann–Whitney), ties averaged. null when a class is empty. */
export function auroc(scores: readonly number[], labels: readonly boolean[]): number | null {
  const pos = labels.filter(Boolean).length;
  const neg = labels.length - pos;
  if (pos === 0 || neg === 0) return null;
  const idx = scores.map((s, i) => ({ s, y: labels[i]! })).sort((a, b) => a.s - b.s);
  let rankSumPos = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]!.s === idx[i]!.s) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (idx[k]!.y) rankSumPos += avgRank;
    i = j + 1;
  }
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

export interface ReliabilityBin {
  readonly lo: number;
  readonly hi: number;
  readonly n: number;
  readonly meanPredicted: number | null;
  readonly observedRate: number | null;
}

export function reliability(probs: readonly number[], labels: readonly boolean[], bins = 10): ReliabilityBin[] {
  const out: ReliabilityBin[] = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const members = probs
      .map((p, i) => ({ p, y: labels[i]! }))
      .filter(({ p }) => p >= lo && (b === bins - 1 ? p <= hi : p < hi));
    const n = members.length;
    out.push({
      lo,
      hi,
      n,
      meanPredicted: n ? members.reduce((s, m) => s + m.p, 0) / n : null,
      observedRate: n ? members.filter((m) => m.y).length / n : null,
    });
  }
  return out;
}

/** Expected calibration error over equal-width bins. */
export function ece(probs: readonly number[], labels: readonly boolean[], bins = 10): number {
  const total = probs.length;
  if (total === 0) return 0;
  return reliability(probs, labels, bins).reduce(
    (s, b) => (b.n ? s + (b.n / total) * Math.abs(b.meanPredicted! - b.observedRate!) : s),
    0,
  );
}

/**
 * Adaptive (equal-mass) ECE: bins hold equal counts of sorted predictions.
 * Preferred for gating when predictions are skewed toward a low base rate —
 * equal-width upper bins are nearly empty and dominated by noise.
 */
export function adaptiveEce(probs: readonly number[], labels: readonly boolean[], bins = 10): number {
  const n = probs.length;
  if (n === 0) return 0;
  const sorted = probs.map((p, i) => ({ p, y: labels[i]! })).sort((a, b) => a.p - b.p);
  let total = 0;
  for (let b = 0; b < bins; b++) {
    const members = sorted.slice(Math.floor((b * n) / bins), Math.floor(((b + 1) * n) / bins));
    if (members.length === 0) continue;
    const meanP = members.reduce((s, m) => s + m.p, 0) / members.length;
    const rate = members.filter((m) => m.y).length / members.length;
    total += (members.length / n) * Math.abs(meanP - rate);
  }
  return total;
}

export function brier(probs: readonly number[], labels: readonly boolean[]): number {
  if (probs.length === 0) return 0;
  return probs.reduce((s, p, i) => s + (p - (labels[i] ? 1 : 0)) ** 2, 0) / probs.length;
}

// ── ridge logistic regression (IRLS / Newton) ──────────────────────────────

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    const d = M[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}

export interface FitOptions {
  readonly l2?: number;
  readonly iterations?: number;
  /** Per-column flags: coefficient constrained to ≥ 0 (active-set refit). */
  readonly nonNegative?: readonly boolean[];
}

/**
 * Ridge logistic regression with optional non-negativity constraints: fit,
 * pin any violating constrained coefficient to 0, drop it, refit — until
 * none violate. Deterministic. Returns [intercept, ...coefficients].
 */
export function fitLogistic(
  X: readonly (readonly number[])[],
  y: readonly boolean[],
  opts: FitOptions = {},
): number[] {
  const cols = X[0]?.length ?? 0;
  const nonNeg = opts.nonNegative ?? [];
  let free = Array.from({ length: cols }, (_, k) => k);
  for (;;) {
    const sub = fitUnconstrained(
      X.map((row) => free.map((k) => row[k]!)),
      y,
      opts,
    );
    const violating = free.filter((k, j) => nonNeg[k] && sub[j + 1]! < 0);
    if (violating.length === 0) {
      const beta = new Array<number>(cols + 1).fill(0);
      beta[0] = sub[0]!;
      free.forEach((k, j) => (beta[k + 1] = sub[j + 1]!));
      return beta;
    }
    free = free.filter((k) => !violating.includes(k));
  }
}

function fitUnconstrained(
  X: readonly (readonly number[])[],
  y: readonly boolean[],
  opts: FitOptions = {},
): number[] {
  const l2 = opts.l2 ?? 1;
  const iters = opts.iterations ?? 25;
  const d = (X[0]?.length ?? 0) + 1;
  const beta = new Array<number>(d).fill(0);
  const pos = y.filter(Boolean).length;
  const base = Math.min(0.99, Math.max(0.01, pos / Math.max(1, y.length)));
  beta[0] = Math.log(base / (1 - base));
  for (let it = 0; it < iters; it++) {
    const H: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    const g = new Array<number>(d).fill(0);
    for (let i = 0; i < X.length; i++) {
      const xi = [1, ...X[i]!];
      let z = 0;
      for (let k = 0; k < d; k++) z += beta[k]! * xi[k]!;
      const p = 1 / (1 + Math.exp(-z));
      const w = Math.max(p * (1 - p), 1e-6);
      const r = (y[i] ? 1 : 0) - p;
      for (let a = 0; a < d; a++) {
        g[a]! += xi[a]! * r;
        for (let b = 0; b < d; b++) H[a]![b]! += w * xi[a]! * xi[b]!;
      }
    }
    for (let k = 1; k < d; k++) {
      g[k]! -= l2 * beta[k]!;
      H[k]![k]! += l2;
    }
    const step = solve(H, g);
    let maxStep = 0;
    for (let k = 0; k < d; k++) {
      beta[k]! += step[k]!;
      maxStep = Math.max(maxStep, Math.abs(step[k]!));
    }
    if (maxStep < 1e-8) break;
  }
  return beta;
}

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
   * Gates the fast path separately. Approval is stubbed (logged only) in this
   * build; a live approval actuator must require this to pass.
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
