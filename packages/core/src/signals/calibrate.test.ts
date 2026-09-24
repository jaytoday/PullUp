import { describe, expect, it } from "vitest";
import { adaptiveEce, auroc, brier, ece, fitLogistic } from "./calibrate.js";
import { mulberry32 } from "../testing/generate.js";

describe("metrics", () => {
  it("AUROC: perfect, inverted, ties, degenerate", () => {
    expect(auroc([0.1, 0.2, 0.8, 0.9], [false, false, true, true])).toBe(1);
    expect(auroc([0.9, 0.8, 0.2, 0.1], [false, false, true, true])).toBe(0);
    expect(auroc([0.5, 0.5, 0.5, 0.5], [false, true, false, true])).toBe(0.5);
    expect(auroc([0.1, 0.2], [true, true])).toBeNull();
  });

  it("ECE is 0 for a perfectly calibrated bin and positive otherwise", () => {
    const probs = [0.25, 0.25, 0.25, 0.25];
    expect(ece(probs, [true, false, false, false])).toBeCloseTo(0);
    expect(adaptiveEce(probs, [true, false, false, false], 1)).toBeCloseTo(0);
    expect(ece([0.9, 0.9], [false, false])).toBeCloseTo(0.9);
    expect(brier([1, 0], [true, false])).toBe(0);
  });
});

describe("fitLogistic", () => {
  function data(n: number, seed: number) {
    const rand = mulberry32(seed);
    const X: number[][] = [];
    const y: boolean[] = [];
    for (let i = 0; i < n; i++) {
      const a = rand();
      const b = rand();
      const z = -2 + 3 * a - 1.5 * b;
      X.push([a, b]);
      y.push(rand() < 1 / (1 + Math.exp(-z)));
    }
    return { X, y };
  }

  it("recovers coefficient signs and is deterministic", () => {
    const { X, y } = data(2_000, 3);
    const beta = fitLogistic(X, y, { l2: 0.1 });
    expect(beta[1]!).toBeGreaterThan(1.5);
    expect(beta[2]!).toBeLessThan(-0.5);
    expect(fitLogistic(X, y, { l2: 0.1 })).toEqual(beta);
  });

  it("non-negativity constraints pin violating coefficients to 0", () => {
    const { X, y } = data(2_000, 3);
    const beta = fitLogistic(X, y, { l2: 0.1, nonNegative: [true, true] });
    expect(beta[1]!).toBeGreaterThan(0);
    expect(beta[2]).toBe(0);
  });
});
