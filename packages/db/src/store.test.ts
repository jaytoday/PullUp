import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import {
  DEFAULT_POLICY,
  DEFAULT_PRIORS,
  InMemoryStore,
  LoggingReviewActuator,
  QUESTION_SET_V1,
  buildReport,
  ingestRepo,
  planReviewActions,
  renderJson,
  resolveJevConfig,
  runSignals,
} from "@pullup/core";
import type { FixtureFile, PullStore } from "@pullup/core";
import {
  FixtureSource,
  SyntheticSignalModel,
  generateRepo,
  sourceFromFixtureFile,
} from "@pullup/core/testing";
import { SqliteStore } from "./store.js";

async function openStore(): Promise<SqliteStore> {
  const client = createClient({ url: ":memory:" });
  const store = new SqliteStore(client);
  await store.migrate();
  return store;
}

describe("SqliteStore", () => {
  it("round-trips a generated repo and ingests idempotently", async () => {
    const store = await openStore();
    const source = new FixtureSource(generateRepo({ seed: 7, n: 30 }));

    const first = await ingestRepo(source, store);
    expect(first.pulls).toBe(30);

    const second = await ingestRepo(source, store);
    expect(second.pulls).toBe(30);
    expect((await store.listPulls("fixtures/healthy")).length).toBe(30);

    const pulls = await store.listPulls("fixtures/healthy");
    const p0 = pulls[0]!;
    expect(Array.isArray(p0.files)).toBe(true);
    expect(typeof p0.draft).toBe("boolean");
    expect(await store.listReviews("fixtures/healthy")).toHaveLength(second.reviews);
    expect((await store.listRepositories())).toContain("fixtures/healthy");
  });

  it("serves the same analytics report as the in-memory store", async () => {
    const sqlite = await openStore();
    const memory = new InMemoryStore();
    const source = new FixtureSource(generateRepo({ seed: 11, n: 60 }));

    await ingestRepo(source, sqlite);
    await ingestRepo(source, memory);

    const fromSqlite = await buildReport(sqlite, "fixtures/healthy", DEFAULT_PRIORS);
    const fromMemory = await buildReport(memory, "fixtures/healthy", DEFAULT_PRIORS);

    expect(fromSqlite.analytics).toEqual(fromMemory.analytics);
    expect(fromSqlite.summary.counts).toEqual(fromMemory.summary.counts);
  });

  it("round-trips hunks (replace semantics), signals, runs, and review actions", async () => {
    const store = await openStore();
    const h = (index: number, patch: string) => ({
      repoId: "o/r",
      pullNumber: 1,
      path: "src/a.ts",
      index,
      header: "@@ -1 +1 @@",
      patch,
      noPatch: false,
      contentHash: `h${index}${patch}`,
    });
    await store.replaceHunks("o/r", 1, [h(0, "+a"), h(1, "+b")]);
    await store.replaceHunks("o/r", 1, [h(0, "+c")]);
    expect(await store.listHunks("o/r", 1)).toEqual([h(0, "+c")]);

    const result = { answers: { q: { kind: "noul" as const, p: 0.3 } }, modelId: "jev-1.13.0", inputTokens: 5, latencyMs: 9 };
    const sig = {
      cacheKey: "k1",
      repoId: "o/r",
      pullNumber: 1,
      unitKey: "src/a.ts#0",
      modelId: "jev-1.13.0",
      questionSetVersion: "q-v1",
      result,
      evaluatedAt: "2026-09-01T00:00:00.000Z",
    };
    await store.upsertSignal(sig);
    expect(await store.getSignal("k1")).toEqual(sig);
    expect(await store.getSignal("missing")).toBeNull();
  });

  it("serves the same active-mode Jev report + review actions as the in-memory store", async () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../../../fixtures/jev.json", import.meta.url), "utf8"),
    ) as FixtureFile;
    const now = "2026-09-01T00:00:00.000Z";
    const jev = {
      config: resolveJevConfig({ mode: "active" }),
      policy: DEFAULT_POLICY,
      qs: QUESTION_SET_V1,
      modelId: "synthetic-v1",
      calibration: null,
    };
    const out: string[] = [];
    const actions: unknown[] = [];
    for (const store of [await openStore(), new InMemoryStore()] as PullStore[]) {
      await ingestRepo(sourceFromFixtureFile(fixture), store, { now });
      const run = await runSignals(store, "fixtures/jev", new SyntheticSignalModel(), QUESTION_SET_V1, { now });
      expect(run.evaluated).toBeGreaterThan(0);
      const report = await buildReport(store, "fixtures/jev", DEFAULT_PRIORS, { now, jev });
      out.push(renderJson(report));
      const planned = planReviewActions(report.decisions, await store.listPulls("fixtures/jev"), {
        repoId: "fixtures/jev",
      });
      await new LoggingReviewActuator(store, () => now).apply(planned);
      const logged = await store.listReviewActions("fixtures/jev");
      actions.push(logged.sort((a, b) => a.pullNumber - b.pullNumber || a.action.localeCompare(b.action)));
    }
    expect(out[0]).toBe(out[1]);
    expect(actions[0]).toEqual(actions[1]);
  });
});
