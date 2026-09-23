// Small deterministic statistics used across the analytics + cost modules.

/** Sorted-copy helper; all percentile/mean helpers accept unsorted input. */
function sorted(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

/** p-th percentile (0..100) of a numeric sample. Null when empty. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = sorted(xs);
  const idx = ((s.length - 1) * p) / 100;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = s[lo] ?? s[0]!;
  const b = s[hi] ?? s[0]!;
  return a + (b - a) * (idx - lo);
}

export function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export interface LatencyStats {
  readonly n: number;
  readonly mean: number | null;
  readonly p10: number | null;
  readonly p50: number | null;
  readonly p90: number | null;
}

export function latencyStats(xs: readonly number[]): LatencyStats {
  return {
    n: xs.length,
    mean: mean(xs),
    p10: percentile(xs, 10),
    p50: percentile(xs, 50),
    p90: percentile(xs, 90),
  };
}

/** Pearson correlation coefficient over paired samples. Null when degenerate. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const xm = mean(xs);
  const ym = mean(ys);
  if (xm === null || ym === null) return null;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]! - xm;
    const y = ys[i]! - ym;
    num += x * y;
    dx += x * x;
    dy += y * y;
  }
  const den = Math.sqrt(dx * dy);
  if (den === 0) return null;
  return num / den;
}

/** Shrinkage: (count + prior·k) / (n + k). Returns 0 when both are 0. */
export function shrunkRate(count: number, n: number, prior: number, k: number): number {
  if (n + k === 0) return 0;
  return (count + prior * k) / (n + k);
}

/** Clamp helper. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
