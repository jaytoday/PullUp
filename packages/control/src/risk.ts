// Raise-only risk signals.
//
// An AI check (possible fraud, a possible policy exclusion, a missing
// document) may push a case toward a person; it can never pull a case toward
// automatic approval. Each signal is a probability that it found a real
// problem; they combine with the base risk as independent chances of a bad
// outcome ("noisy-or"), which can only go up.

export interface RiskSignal {
  readonly name: string;
  /** 0..1 — how likely this signal is pointing at a real problem. */
  readonly probability: number;
  /** Optional plain-language reason, shown when the case is referred. */
  readonly reason?: string;
}

const clamp = (p: number) => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0);

/** Combined risk, never below `base`. Invalid signal values count as 0. */
export function combineRisk(base: number, signals: readonly RiskSignal[]): number {
  let fine = 1 - clamp(base);
  for (const s of signals) fine *= 1 - clamp(s.probability);
  return Math.max(clamp(base), 1 - fine);
}
