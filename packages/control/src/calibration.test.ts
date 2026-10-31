import { describe, expect, it } from "vitest";
import { calibrate, DEFAULT_GATES, fitLogistic, outOfFoldPredictions, predict, scoreCase } from "./calibration.js";
import { CLAIM_FEATURES, generateClaims } from "./examples/insurance-claims.js";

describe("calibrate", () => {
  const history = generateClaims({ count: 3000, seed: 11 });

  it("passes both gates on well-behaved synthetic claims", () => {
    const a = calibrate(history, CLAIM_FEATURES, { scope: "s", now: "2026-10-31T00:00:00.000Z" });
    expect(a.gate.passed).toBe(true);
    expect(a.autoGate.passed).toBe(true);
    expect(a.metrics.auroc!).toBeGreaterThan(0.7);
    expect(Object.keys(a.predictions)).toHaveLength(3000);
  });

  it("is deterministic (same inputs, same hash)", () => {
    const opts = { scope: "s", now: "2026-10-31T00:00:00.000Z" };
    expect(calibrate(history, CLAIM_FEATURES, opts).hash).toBe(calibrate(history, CLAIM_FEATURES, opts).hash);
  });

  it("keeps risk-signal weights non-negative", () => {
    const a = calibrate(history, CLAIM_FEATURES, { scope: "s" });
    CLAIM_FEATURES.forEach((f, k) => {
      if (f.riskSignal) expect(a.beta[k + 1]!).toBeGreaterThanOrEqual(0);
    });
  });

  it("fails the gates with too little history, and the auto gate needs the risk gate", () => {
    const a = calibrate(history.slice(0, 80), CLAIM_FEATURES, { scope: "s" });
    expect(a.gate.passed).toBe(false);
    expect(a.autoGate.passed).toBe(false);
    expect(a.autoGate.checks.find((c) => c.name === "risk model gate")!.passed).toBe(false);
  });

  it("fails the auto gate when the precision bar is out of reach", () => {
    const a = calibrate(history, CLAIM_FEATURES, { scope: "s", gates: { ...DEFAULT_GATES, minAutoPrecision: 0.999 } });
    expect(a.gate.passed).toBe(true);
    expect(a.autoGate.passed).toBe(false);
  });

  it("scoreCase matches predict on the artifact's coefficients", () => {
    const a = calibrate(history, CLAIM_FEATURES, { scope: "s" });
    const c = history[0]!;
    expect(scoreCase(a, c.features)).toBeCloseTo(predict(a.beta, CLAIM_FEATURES.map((f) => c.features[f.name] ?? 0)));
  });
});

describe("fit helpers", () => {
  it("non-negative constraint pins a negative weight to zero", () => {
    const X = [[1, 1], [1, 1], [0, 1], [0, 0], [1, 0], [0, 0]];
    const y = [true, true, false, false, true, false];
    const beta = fitLogistic(X, y, { nonNegative: [false, true] });
    expect(beta[2]!).toBeGreaterThanOrEqual(0);
  });

  it("out-of-fold predictions need enough rows and a positive label", () => {
    expect(outOfFoldPredictions([[1]], [true], 5)).toBeNull();
    expect(outOfFoldPredictions([[1], [2], [3], [4], [5]], [false, false, false, false, false], 5)).toBeNull();
  });
});
