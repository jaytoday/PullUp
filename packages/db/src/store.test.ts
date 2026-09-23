import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { DEFAULT_PRIORS, InMemoryStore, buildReport, ingestRepo } from "@pullup/core";
import { FixtureSource, generateRepo } from "@pullup/core/testing";
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
});
