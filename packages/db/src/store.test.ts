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

describe("SqliteStore config versions", () => {
  it("appends numbered versions, round-trips them, and rejects stale saves", async () => {
    const store = await openStore();
    const rec = {
      repoId: "o/r",
      config: { guardrails: { maxAutoApproveLines: 300 } },
      hash: "h1",
      note: "first",
      loosened: [],
      author: "local",
      createdAt: "2026-09-01T00:00:00.000Z",
      restoredFrom: null,
    };
    const v1 = await store.appendConfigVersion(rec, null);
    expect(v1.version).toBe(1);
    const v2 = await store.appendConfigVersion({ ...rec, hash: "h2", loosened: ["guardrails.maxAutoApproveLines"] }, 1);
    expect(v2.version).toBe(2);
    await expect(store.appendConfigVersion(rec, 1)).rejects.toThrow(/changed since/);
    const all = await store.listConfigVersions("o/r");
    expect(all.map((v) => v.version)).toEqual([1, 2]);
    expect(all[1]).toEqual(v2);
    expect(await store.listConfigVersions("other/repo")).toEqual([]);
  });
});

describe("SqliteStore authority layer", () => {
  const NOW = "2026-10-05T12:00:00.000Z";

  it("stop switch, enrollment and agents round-trip", async () => {
    const store = await openStore();
    expect(await store.getControlState("global")).toBeNull();
    await store.setControlState({ scope: "global", stopped: true, reason: "r", by: "cli", at: NOW });
    expect(await store.getControlState("global")).toEqual({ scope: "global", stopped: true, reason: "r", by: "cli", at: NOW });
    await store.setEnrollment({ repoId: "o/r", profile: "review", by: "cli", at: NOW });
    expect((await store.getEnrollment("o/r"))?.profile).toBe("review");
    const agent = { agentId: "pullup/cli", version: "abc123", status: "pending" as const, inputs: { a: "b" }, firstSeen: NOW, updatedAt: NOW, updatedBy: null, note: "" };
    await store.upsertAgent(agent);
    await store.upsertAgent({ ...agent, status: "approved", updatedBy: "cli" });
    expect(await store.getAgent("pullup/cli", "abc123")).toMatchObject({ status: "approved", inputs: { a: "b" } });
    expect(await store.listAgents()).toHaveLength(1);
  });

  it("finding comments upsert by (repo, pull, key) and filter by pull", async () => {
    const store = await openStore();
    const row = {
      repoId: "acme/api",
      pullNumber: 7,
      findingKey: "0123456789abcdef",
      findingId: "signal:touchesAuthz",
      path: "src/auth.ts",
      commentId: 500,
      firstHeadSha: "sha1",
      lastSeenHeadSha: "sha1",
      status: "open" as const,
      resolvedHeadSha: null,
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    await store.upsertFindingComment(row);
    await store.upsertFindingComment({ ...row, status: "resolved-by-pullup", resolvedHeadSha: "sha2" });
    await store.upsertFindingComment({ ...row, pullNumber: 8 });
    expect(await store.listFindingComments("acme/api", 7)).toEqual([{ ...row, status: "resolved-by-pullup", resolvedHeadSha: "sha2" }]);
    expect(await store.listFindingComments("acme/api")).toHaveLength(2);
  });

  it("verdicts and verify runs round-trip", async () => {
    const store = await openStore();
    const rec = {
      cacheKey: "k1",
      repoId: "acme/api",
      pullNumber: 7,
      findingId: "signal:touchesAuthz",
      hunksHash: "h",
      verdict: { verdict: "confirmed" as const, accepted: true, evidence: [{ path: "a.ts", line: 3, quote: "x = 1;" }], fix: null, reason: "r", verifierId: "v1" },
      costUsd: 0.02,
      createdAt: "2026-10-19T00:00:00.000Z",
    };
    await store.upsertVerdict(rec);
    expect(await store.getVerdict("k1")).toEqual(rec);
    expect(await store.listVerdicts("acme/api", 7)).toEqual([rec]);
    expect(await store.getVerdict("nope")).toBeNull();
    const run = { repoId: "acme/api", runAt: "2026-10-19T00:00:00.000Z", verifierId: "v1", verified: 1, cached: 0, skipped: [], costUsd: 0.02, errors: [] };
    await store.recordVerifyRun(run);
    expect(await store.listVerifyRuns("acme/api")).toEqual([run]);
  });

  it("permit nonces are single use", async () => {
    const store = await openStore();
    expect(await store.consumePermitNonce("n1", "t1", NOW)).toBe(true);
    expect(await store.consumePermitNonce("n1", "t1", NOW)).toBe(false);
  });

  it("evidence is append-only and chained", async () => {
    const { appendEvidence, verifyEvidenceChain } = await import("@pullup/core");
    const client = createClient({ url: ":memory:" });
    const store = new SqliteStore(client);
    await store.migrate();
    await appendEvidence(store, { repoId: "o/r", taskId: "t1", agentVersion: "v", kind: "planned", at: NOW, payload: { a: 1 } });
    await appendEvidence(store, { repoId: "o/r", taskId: "t1", agentVersion: "v", kind: "logged", at: NOW, payload: {} });
    const rows = await store.listEvidence({ taskId: "t1" });
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(verifyEvidenceChain(rows).ok).toBe(true);
    expect(await store.listEvidence({ agentVersion: "other" })).toEqual([]);
    await expect(client.execute("UPDATE evidence SET payload = '{}' WHERE seq = 1")).rejects.toThrow(/append-only/);
    await expect(store.insertEvidence(rows[0]!)).rejects.toThrow();
  });
});
