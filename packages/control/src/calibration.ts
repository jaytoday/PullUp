// Calibration: measuring whether predicted probabilities match what actually
// happened, and fitting a small risk model to an organization's own labelled
// history. Moved here from @pullup/core (which re-exports it) so any kind of
// case — a pull request, an insurance claim, a submission — can use it.
//
// Everything is deterministic: same inputs, same numbers.

import { canonicalJson, round, sha256 } from "./canonical.js";

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


// ── prediction, out-of-fold evaluation and the promotion gates ─────────────

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Probability from `[intercept, ...coefficients]` and one feature row. */
export function predict(beta: readonly number[], x: readonly number[]): number {
  let z = beta[0] ?? 0;
  x.forEach((v, k) => (z += (beta[k + 1] ?? 0) * v));
  return sigmoid(z);
}

/**
 * Honest predictions: each row is scored by a model fitted without it
 * (k folds, row i in fold i mod k). Returns null when there are too few rows
 * or no positive labels to fit.
 */
export function outOfFoldPredictions(
  X: readonly (readonly number[])[],
  y: readonly boolean[],
  folds: number,
  opts: FitOptions = {},
): number[] | null {
  if (X.length < folds || !y.some(Boolean)) return null;
  const out = new Array<number>(X.length).fill(0);
  for (let f = 0; f < folds; f++) {
    const train = X.map((_, i) => i).filter((i) => i % folds !== f);
    const beta = fitLogistic(train.map((i) => X[i]!), train.map((i) => y[i]!), opts);
    X.forEach((x, i) => {
      if (i % folds === f) out[i] = predict(beta, x);
    });
  }
  return out;
}

export interface GateCheck {
  readonly name: string;
  readonly value: number | null;
  readonly threshold: number;
  readonly passed: boolean;
}

export interface Gate {
  readonly passed: boolean;
  readonly checks: readonly GateCheck[];
}

export function gate(checks: readonly GateCheck[]): Gate {
  return { passed: checks.length > 0 && checks.every((c) => c.passed), checks };
}

export interface FeatureSpec {
  readonly name: string;
  /**
   * True for a risk signal: its weight is forced to be ≥ 0, so a stronger
   * signal can never lower the predicted risk (an unconstrained fit on
   * correlated features can produce a negative weight).
   */
  readonly riskSignal?: boolean;
}

export interface CalibrationGates {
  /** Labelled cases needed before anything is promoted. */
  readonly minCases: number;
  /** Positive (bad-outcome) labels needed. */
  readonly minPositives: number;
  /** Out-of-fold AUROC (ranking quality, 0.5 = coin flip). */
  readonly minAuroc: number;
  /** Out-of-fold adaptive calibration error (lower is better). */
  readonly maxEce: number;
  /** The automatic-approval path: predicted risk at or below this is eligible. */
  readonly autoApproveMaxRisk: number;
  /** Share of auto-eligible cases that must have turned out fine. */
  readonly minAutoPrecision: number;
  /** Auto-eligible cases needed to measure that precision. */
  readonly minAutoCases: number;
}

export const DEFAULT_GATES: CalibrationGates = {
  minCases: 200,
  minPositives: 20,
  minAuroc: 0.7,
  maxEce: 0.06,
  autoApproveMaxRisk: 0.05,
  minAutoPrecision: 0.97,
  minAutoCases: 50,
};

export interface LabelledCase {
  readonly id: string;
  readonly features: Readonly<Record<string, number>>;
  /** True when the case later turned out badly (overpaid, reopened, fraud, defect). */
  readonly bad: boolean;
}

export interface CalibrationArtifact {
  readonly kind: "control-calibration";
  readonly version: 1;
  readonly scope: string;
  readonly createdAt: string;
  readonly features: readonly FeatureSpec[];
  /** `[intercept, ...coefficients]` in `features` order, fitted on all rows. */
  readonly beta: readonly number[];
  readonly labelled: { readonly cases: number; readonly positives: number };
  readonly metrics: { readonly auroc: number | null; readonly ece: number; readonly brier: number; readonly reliability: readonly ReliabilityBin[] };
  readonly autoPath: { readonly eligible: number; readonly bad: number; readonly precision: number | null };
  /** Gates using the model's probabilities at all. */
  readonly gate: Gate;
  /** Gates automatic approval separately (stricter). */
  readonly autoGate: Gate;
  /** Out-of-fold predictions, by case id — what fairness checks read. */
  readonly predictions: Readonly<Record<string, number>>;
  readonly hash: string;
}

/**
 * Fit a risk model to labelled cases, measure it out of fold and apply both
 * gates. Only a passing artifact should move any decision.
 */
export function calibrate(
  cases: readonly LabelledCase[],
  features: readonly FeatureSpec[],
  opts: { readonly scope: string; readonly now?: string; readonly folds?: number; readonly gates?: CalibrationGates; readonly l2?: number },
): CalibrationArtifact {
  const gates = opts.gates ?? DEFAULT_GATES;
  const folds = opts.folds ?? 5;
  const fit: FitOptions = { nonNegative: features.map((f) => f.riskSignal === true), l2: opts.l2 };
  const X = cases.map((c) => features.map((f) => c.features[f.name] ?? 0));
  const y = cases.map((c) => c.bad);
  const positives = y.filter(Boolean).length;

  const oof = outOfFoldPredictions(X, y, folds, fit) ?? cases.map(() => positives / Math.max(1, cases.length));
  const beta = cases.length > 0 && positives > 0 ? fitLogistic(X, y, fit) : [0, ...features.map(() => 0)];

  const a = auroc(oof, y);
  const e = adaptiveEce(oof, y);
  const autoIdx = oof.map((p, i) => (p <= gates.autoApproveMaxRisk ? i : -1)).filter((i) => i >= 0);
  const autoBad = autoIdx.filter((i) => y[i]).length;
  const precision = autoIdx.length > 0 ? (autoIdx.length - autoBad) / autoIdx.length : null;

  const base: GateCheck[] = [
    { name: "labelled cases", value: cases.length, threshold: gates.minCases, passed: cases.length >= gates.minCases },
    { name: "bad-outcome labels", value: positives, threshold: gates.minPositives, passed: positives >= gates.minPositives },
    { name: "out-of-fold AUROC", value: a === null ? null : round4(a), threshold: gates.minAuroc, passed: (a ?? 0) >= gates.minAuroc },
    { name: "out-of-fold calibration error (adaptive)", value: round4(e), threshold: gates.maxEce, passed: e <= gates.maxEce },
  ];
  const g = gate(base);
  const autoChecks: GateCheck[] = [
    { name: "risk model gate", value: g.passed ? 1 : 0, threshold: 1, passed: g.passed },
    { name: "auto-eligible cases", value: autoIdx.length, threshold: gates.minAutoCases, passed: autoIdx.length >= gates.minAutoCases },
    { name: "auto-path precision", value: precision === null ? null : round4(precision), threshold: gates.minAutoPrecision, passed: (precision ?? 0) >= gates.minAutoPrecision },
  ];

  const body = {
    kind: "control-calibration" as const,
    version: 1 as const,
    scope: opts.scope,
    createdAt: opts.now ?? new Date().toISOString(),
    features,
    beta: beta.map((b) => round4(b, 6)),
    labelled: { cases: cases.length, positives },
    metrics: { auroc: a === null ? null : round4(a), ece: round4(e), brier: round4(brier(oof, y)), reliability: reliability(oof, y) },
    autoPath: { eligible: autoIdx.length, bad: autoBad, precision: precision === null ? null : round4(precision) },
    gate: g,
    autoGate: gate(autoChecks),
    predictions: Object.fromEntries(cases.map((c, i) => [c.id, round4(oof[i]!, 6)])),
  };
  return { ...body, hash: sha256(canonicalJson(body)) };
}

/** Score one new case with a calibrated artifact. */
export function scoreCase(artifact: Pick<CalibrationArtifact, "beta" | "features">, features: Readonly<Record<string, number>>): number {
  return predict(artifact.beta, artifact.features.map((f) => features[f.name] ?? 0));
}

const round4 = (x: number, d = 4) => round(x, d);
