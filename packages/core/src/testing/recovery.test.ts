import { describe, expect, it } from "vitest";
import { DEFAULT_PRIORS } from "../config/config.js";
import { FixtureSource, generateRepo } from "../testing/generate.js";
import { InMemoryStore } from "../schema/store.js";
import { ingestRepo } from "../ingest/pipeline.js";
import { runAnalytics } from "../analytics/run.js";
import { assembleParams } from "../cost/params.js";
import { findOptimalWait } from "../cost/model.js";
import { recoveryAnalysis } from "./recovery.js";

const NOW = "2026-08-15T00:00:00.000Z";

describe("recoveryAnalysis", () => {
  it("policy approval never costs more than actual behavior (savings ≥ 0)", async () => {
    const store = new InMemoryStore();
    await ingestRepo(new FixtureSource(generateRepo({ seed: 23, n: 120, policy: "congested" })), store);
    const report = await runAnalytics(store, "fixtures/congested", DEFAULT_PRIORS);
    const params = assembleParams(report, DEFAULT_PRIORS);
    const pulls = await store.listPulls("fixtures/congested");

    const result = recoveryAnalysis(pulls, params, NOW);
    expect(result.savingsHours).toBeGreaterThanOrEqual(0);
    expect(result.currentTotal).toBeGreaterThan(0);
    expect(result.rows.length).toBe(pulls.length);
  });

  it("w* stays within [minWait, cap]", async () => {
    const store = new InMemoryStore();
    await ingestRepo(new FixtureSource(generateRepo({ seed: 24, n: 40 })), store);
    const report = await runAnalytics(store, "fixtures/healthy", DEFAULT_PRIORS);
    const params = assembleParams(report, DEFAULT_PRIORS);

    for (const type of ["feature", "bugfix", "docs", "dependency", "refactor"] as const) {
      const w = findOptimalWait(params, type);
      expect(w).toBeGreaterThanOrEqual(params.minWaitHours);
      expect(w).toBeLessThanOrEqual(params.maxWaitHoursCap);
    }
  });
});
