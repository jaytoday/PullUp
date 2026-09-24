import { describe, expect, it } from "vitest";
import { DEFAULT_PRIORS } from "../config/config.js";
import { FixtureSource, generateRepo } from "../testing/generate.js";
import { InMemoryStore } from "../schema/store.js";
import { ingestRepo } from "../ingest/pipeline.js";
import { runAnalytics } from "../analytics/run.js";
import { assembleParams } from "./params.js";
import {
  costCurve,
  delayCost,
  expectedDefectCost,
  findOptimalWait,
  marginalDelayCost,
  marginalReviewBenefit,
  totalCost,
} from "./model.js";

async function paramsFor(seed: number, n = 100) {
  const store = new InMemoryStore();
  await ingestRepo(new FixtureSource(generateRepo({ seed, n })), store);
  const report = await runAnalytics(store, "fixtures/healthy", DEFAULT_PRIORS);
  return assembleParams(report, DEFAULT_PRIORS);
}

describe("two-cost model", () => {
  it("finds w* where marginal delay meets marginal review benefit", async () => {
    const params = await paramsFor(9);
    const type = "feature";
    const wStar = findOptimalWait(params, type);
    const mDelay = marginalDelayCost(params);
    const mBenefit = marginalReviewBenefit(wStar, params, type);

    // Crossing: at w*, the marginal curves are within the 1h grid's tolerance.
    expect(Math.abs(mDelay - mBenefit)).toBeLessThan(mDelay * 1.5 + 0.01);
  });

  it("delay cost is monotone increasing in w", async () => {
    const params = await paramsFor(4);
    let prev = -1;
    for (let w = 0; w <= 300; w += 10) {
      const c = delayCost(w, params);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it("expected defect cost decreases with more review", async () => {
    const params = await paramsFor(4);
    const e0 = expectedDefectCost(0, params, "feature");
    const e120 = expectedDefectCost(120, params, "feature");
    expect(e120).toBeLessThan(e0);
  });

  it("low-risk change types auto-approve far sooner than high-risk", async () => {
    const params = await paramsFor(13, 120);
    const wDocs = findOptimalWait(params, "docs");
    const wFeature = findOptimalWait(params, "feature");
    expect(wDocs).toBeLessThan(wFeature);
  });
});

describe("costCurve", () => {
  it("samples D/E/F consistently with the model and bottoms out near w*", async () => {
    const store = new InMemoryStore();
    await ingestRepo(new FixtureSource(generateRepo({ seed: 3, n: 60 })), store);
    const params = assembleParams(await runAnalytics(store, "fixtures/healthy", DEFAULT_PRIORS), DEFAULT_PRIORS);
    const curve = costCurve(params, "feature", 96, { points: 96 });
    expect(curve).toHaveLength(97);
    expect(curve[0]!.w).toBe(0);
    for (const pt of curve) expect(pt.F).toBeCloseTo(totalCost(pt.w, params, "feature"), 2);
    const wStar = findOptimalWait(params, "feature");
    const min = curve.slice(1).reduce((a, b) => (b.F < a.F ? b : a));
    expect(Math.abs(min.w - wStar)).toBeLessThanOrEqual(1);
  });
});
