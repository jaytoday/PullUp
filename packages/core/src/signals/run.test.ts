import { describe, expect, it } from "vitest";
import { ingestRepo } from "../ingest/pipeline.js";
import type { FixtureFile } from "../ingest/source.js";
import { InMemoryStore } from "../schema/store.js";
import { sourceFromFixtureFile } from "../testing/hunks.js";
import { SyntheticSignalModel } from "../testing/synthetic-signals.js";
import { QUESTION_SET_V1 } from "./questions/v1.js";
import { RecordingSignalModel, ReplaySignalModel } from "./replay.js";
import { exportReplayFile, runSignals } from "./run.js";
import type { SignalModel } from "./types.js";

function fixture(patchB = "+b"): FixtureFile {
  const pull = (number: number, patch: string) => ({
    number,
    title: `pr ${number}`,
    author: "a",
    createdAt: "2026-08-01T00:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    state: "open" as const,
    baseBranch: "main",
    headSha: `sha${number}`,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    labels: [],
    draft: false,
    files: [`src/f${number}.ts`],
    hunks: [{ path: `src/f${number}.ts`, index: 0, header: "@@ -1 +1 @@", patch }],
  });
  return { repo: { owner: "o", repo: "r", defaultBranch: "main" }, pulls: [pull(1, "+a"), pull(2, patchB)] };
}

class Counting implements SignalModel {
  readonly id = "synthetic-v1";
  calls = 0;
  private readonly inner = new SyntheticSignalModel();
  async evaluate(...args: Parameters<SignalModel["evaluate"]>) {
    this.calls += args[0].length;
    return this.inner.evaluate(...args);
  }
}

describe("runSignals", () => {
  it("caches by content: a re-run evaluates nothing; a changed hunk re-evaluates only itself", async () => {
    const store = new InMemoryStore();
    await ingestRepo(sourceFromFixtureFile(fixture()), store);
    const model = new Counting();
    const first = await runSignals(store, "o/r", model, QUESTION_SET_V1);
    expect(first).toMatchObject({ units: 2, evaluated: 2, cached: 0 });
    const second = await runSignals(store, "o/r", model, QUESTION_SET_V1);
    expect(second).toMatchObject({ evaluated: 0, cached: 2 });

    await ingestRepo(sourceFromFixtureFile(fixture("+changed")), store);
    const third = await runSignals(store, "o/r", model, QUESTION_SET_V1);
    expect(third).toMatchObject({ evaluated: 1, cached: 1 });
    expect(model.calls).toBe(3);
    expect(await store.listSignalRuns("o/r")).toHaveLength(3);
  });

  it("stops at the budget and counts the rest as skipped", async () => {
    const store = new InMemoryStore();
    await ingestRepo(sourceFromFixtureFile(fixture()), store);
    const run = await runSignals(store, "o/r", new SyntheticSignalModel(), QUESTION_SET_V1, {
      budgetUsd: 1e-12,
      batchSize: 1,
    });
    expect(run.evaluated).toBe(1);
    expect(run.skippedBudget).toBe(1);
  });

  it("counts failed units and does not cache them", async () => {
    const store = new InMemoryStore();
    await ingestRepo(sourceFromFixtureFile(fixture()), store);
    const failing: SignalModel = { id: "x", evaluate: async (units) => units.map(() => null) };
    const run = await runSignals(store, "o/r", failing, QUESTION_SET_V1);
    expect(run).toMatchObject({ failed: 2, evaluated: 0 });
    expect((await runSignals(store, "o/r", failing, QUESTION_SET_V1)).failed).toBe(2);
  });

  it("record → replay reproduces answers exactly; a miss fails loudly", async () => {
    const store = new InMemoryStore();
    await ingestRepo(sourceFromFixtureFile(fixture()), store);
    const rec = new RecordingSignalModel(new SyntheticSignalModel());
    await runSignals(store, "o/r", rec, QUESTION_SET_V1);
    const replayFile = rec.toReplayFile();
    expect(Object.keys(replayFile.entries)).toHaveLength(2);

    const fresh = new InMemoryStore();
    await ingestRepo(sourceFromFixtureFile(fixture()), fresh);
    const replay = new ReplaySignalModel(replayFile);
    expect(replay.id).toBe("synthetic-v1");
    expect((await runSignals(fresh, "o/r", replay, QUESTION_SET_V1)).evaluated).toBe(2);

    const other = new InMemoryStore();
    await ingestRepo(sourceFromFixtureFile(fixture("+never recorded")), other);
    await expect(runSignals(other, "o/r", replay, QUESTION_SET_V1)).rejects.toThrow(/Replay miss/);
  });

  it("exportReplayFile includes units cached by earlier runs (fresh-DB replay has no misses)", async () => {
    const store = new InMemoryStore();
    await ingestRepo(sourceFromFixtureFile(fixture()), store);
    const model = new SyntheticSignalModel();
    await runSignals(store, "o/r", model, QUESTION_SET_V1, { pullNumbers: [1] });
    // Second run only evaluates PR 2; PR 1 is already cached.
    const run = await runSignals(store, "o/r", model, QUESTION_SET_V1);
    expect(run).toMatchObject({ evaluated: 1, cached: 1 });
    const file = await exportReplayFile(store, "o/r", QUESTION_SET_V1, model.id);
    expect(Object.keys(file.entries)).toHaveLength(2);

    const fresh = new InMemoryStore();
    await ingestRepo(sourceFromFixtureFile(fixture()), fresh);
    expect((await runSignals(fresh, "o/r", new ReplaySignalModel(file), QUESTION_SET_V1)).evaluated).toBe(2);
  });
});
