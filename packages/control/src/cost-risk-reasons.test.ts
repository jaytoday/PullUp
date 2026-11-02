import { describe, expect, it } from "vitest";
import { breakEvenRisk, compareCosts } from "./cost.js";
import { topReasons } from "./reasons.js";
import { combineRisk } from "./risk.js";

describe("compareCosts", () => {
  const costs = { handlingCost: 100, delayCostPerDay: 20, reviewDays: 3, lossIfWrong: 1000 };
  it("acts when the expected loss is below the review cost", () => {
    expect(breakEvenRisk(costs)).toBeCloseTo(0.16);
    expect(compareCosts(0.1, costs).cheaper).toBe("act");
    expect(compareCosts(0.2, costs).cheaper).toBe("review");
  });
  it("a case with nothing to lose has break-even 1", () => {
    expect(breakEvenRisk({ ...costs, lossIfWrong: 0 })).toBe(1);
  });
});

describe("combineRisk", () => {
  it("never lowers risk, whatever the signals say", () => {
    expect(combineRisk(0.2, [])).toBeCloseTo(0.2);
    expect(combineRisk(0.2, [{ name: "x", probability: -5 }])).toBeCloseTo(0.2);
    expect(combineRisk(0.2, [{ name: "x", probability: Number.NaN }])).toBeCloseTo(0.2);
    expect(combineRisk(0.2, [{ name: "x", probability: 0.5 }])).toBeCloseTo(0.6);
  });
});

describe("topReasons", () => {
  const model = { beta: [-3, 1.5, -0.8], features: [{ name: "early", riskSignal: true }, { name: "glass" }] };
  const table = { early: "Loss soon after the policy started.", glass: "Glass only." };
  it("lists only features that raised this case's risk", () => {
    const r = topReasons(model, { early: 1, glass: 0 }, { early: 0.1, glass: 0.3 }, table);
    expect(r.map((x) => x.text)).toEqual(["Loss soon after the policy started."]);
  });
  it("includes AI signals with their own reason text", () => {
    const r = topReasons(model, { early: 0, glass: 1 }, { early: 0.1, glass: 0.3 }, table, { signals: [{ name: "fraud", probability: 0.5, reason: "Fraud flag." }] });
    expect(r.map((x) => x.text)).toEqual(["Fraud flag."]);
  });
});
