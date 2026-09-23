import { describe, expect, it } from "vitest";
import { DEFAULT_PRIORS } from "../config/config.js";
import { ingestRepo } from "./pipeline.js";
import { FixtureSource, generateRepo } from "../testing/generate.js";
import { InMemoryStore } from "../schema/store.js";
import { runAnalytics } from "../analytics/run.js";

describe("ingestRepo", () => {
  it("ingests a generated fixture idempotently", async () => {
    const store = new InMemoryStore();
    const source = new FixtureSource(generateRepo({ seed: 7, n: 30, policy: "healthy" }));

    await ingestRepo(source, store);
    expect((await store.listPulls("fixtures/healthy")).length).toBe(30);

    // Idempotent re-ingest: same content, no growth.
    await ingestRepo(source, store);
    expect((await store.listPulls("fixtures/healthy")).length).toBe(30);
  });

  it("classifies change type and area on every pull", async () => {
    const store = new InMemoryStore();
    await ingestRepo(new FixtureSource(generateRepo({ seed: 3, n: 20 })), store);

    const pulls = await store.listPulls("fixtures/healthy");
    for (const p of pulls) {
      expect(["feature", "bugfix", "refactor", "dependency", "docs", "other"]).toContain(p.changeType);
      expect(p.area.length).toBeGreaterThan(0);
      expect(p.reviewCount).toBeGreaterThan(0);
    }
  });

  it("produces a coherent analytics report end-to-end", async () => {
    const store = new InMemoryStore();
    await ingestRepo(new FixtureSource(generateRepo({ seed: 11, n: 60, policy: "healthy" })), store);

    const report = await runAnalytics(store, "fixtures/healthy", DEFAULT_PRIORS);
    expect(report.pullCount).toBe(60);
    expect(report.mergedCount).toBeGreaterThan(0);
    expect(report.latency.timeToFirstReviewHours.n).toBe(report.pullCount);
    expect(report.latency.timeToFirstReviewHours.p50).toBeGreaterThan(0);
    expect(report.outcomes.buckets.length).toBeGreaterThan(0);
    expect(report.defects.overall.n).toBe(report.mergedCount);
    expect(report.congestion.points.length).toBeGreaterThan(0);
    expect(report.efficacy.eMax).toBeGreaterThan(0);
  });
});
