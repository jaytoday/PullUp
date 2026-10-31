import { describe, expect, it } from "vitest";
import { calibrate } from "./calibration.js";
import { CLAIM_FEATURES, generateClaims } from "./examples/insurance-claims.js";
import { fairnessReport } from "./fairness.js";

const report = (skew: boolean) => {
  const history = generateClaims({ count: 3000, seed: 11, skewGroupB: skew });
  const model = calibrate(history, CLAIM_FEATURES, { scope: "s" });
  return fairnessReport(history.map((c) => ({ group: c.group, risk: model.predictions[c.id]!, bad: c.bad })), { favorableMaxRisk: 0.05 });
};

describe("fairnessReport", () => {
  it("passes when groups are treated alike", () => {
    const r = report(false);
    expect(r.gate.passed).toBe(true);
    expect(r.impactRatio!).toBeGreaterThan(0.9);
  });

  it("fails the adverse impact ratio when one group is approved far less often", () => {
    const r = report(true);
    expect(r.gate.passed).toBe(false);
    expect(r.gate.checks.find((c) => c.name === "adverse impact ratio")!.passed).toBe(false);
  });

  it("fails closed on a group too small to measure, and on a single group", () => {
    const small = fairnessReport(
      [...Array.from({ length: 40 }, () => ({ group: "A", risk: 0.01, bad: false })), { group: "B", risk: 0.01, bad: false }],
      { favorableMaxRisk: 0.05 },
    );
    expect(small.gate.passed).toBe(false);
    const single = fairnessReport(Array.from({ length: 40 }, () => ({ group: "A", risk: 0.01, bad: false })), { favorableMaxRisk: 0.05 });
    expect(single.gate.passed).toBe(false);
    expect(single.impactRatio).toBeNull();
  });
});
