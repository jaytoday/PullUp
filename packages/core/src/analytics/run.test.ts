import { describe, expect, it } from "vitest";
import { DEFAULT_PRIORS } from "../config/config.js";
import { InMemoryStore } from "../schema/store.js";
import { FixtureSource, generateRepo } from "../testing/generate.js";
import { ingestRepo } from "../ingest/pipeline.js";
import { runAnalytics } from "./run.js";

describe("runAnalytics", () => {
  it("congested fixture shows longer first-review latency and deeper queue", async () => {
    const healthy = new InMemoryStore();
    await ingestRepo(new FixtureSource(generateRepo({ seed: 1, n: 60, policy: "healthy" })), healthy);
    const congested = new InMemoryStore();
    await ingestRepo(new FixtureSource(generateRepo({ seed: 2, n: 60, policy: "congested" })), congested);

    const h = await runAnalytics(healthy, "fixtures/healthy", DEFAULT_PRIORS);
    const c = await runAnalytics(congested, "fixtures/congested", DEFAULT_PRIORS);

    expect(h.latency.timeToFirstReviewHours.p50).toBeLessThan(c.latency.timeToFirstReviewHours.p50);
    expect(h.congestion.meanQueueDepth ?? 0).toBeLessThan(c.congestion.meanQueueDepth ?? Infinity);
  });

  it("defect rate lands near the fixture's defect prior", () => {
    // Sample-average over several seeds to damp seed noise.
    let merged = 0;
    let defects = 0;
    for (let seed = 0; seed < 12; seed++) {
      const g = generateRepo({ seed, n: 80, defectPrior: 0.15 });
      merged += g.pulls.filter((p) => p.state === "merged").length;
      defects += g.pulls.reduce((s, p) => s + p.defectEvents.length, 0);
    }
    const rate = defects / merged;
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.22);
  });

  it("healthy fixture reviews land within the generator's 4–48h window", async () => {
    const store = new InMemoryStore();
    await ingestRepo(new FixtureSource(generateRepo({ seed: 5, n: 120, policy: "healthy" })), store);
    const report = await runAnalytics(store, "fixtures/healthy", DEFAULT_PRIORS);

    expect(report.latency.timeToFirstReviewHours.p50).toBeGreaterThan(3);
    expect(report.latency.timeToFirstReviewHours.p90).toBeLessThan(60);
  });

  it("review findings correlate with lower shipped-defect rate", async () => {
    const store = new InMemoryStore();
    await ingestRepo(new FixtureSource(generateRepo({ seed: 17, n: 200, defectPrior: 0.2 })), store);
    const report = await runAnalytics(store, "fixtures/healthy", DEFAULT_PRIORS);

    const wfRate = report.efficacy.withFindings.rate;
    const wofRate = report.efficacy.withoutFindings.rate;
    expect(wfRate).not.toBeNull();
    expect(wofRate).not.toBeNull();
    expect(wfRate!).toBeLessThan(wofRate!);
  });
});
