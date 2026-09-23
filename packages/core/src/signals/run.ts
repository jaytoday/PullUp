// Signal runs: build units from stored hunks, answer only uncached evaluable
// units (content-addressed cache ⇒ a re-push re-evaluates changed hunks only),
// enforce the per-run budget, and persist answers + run accounting.

import type { PullRecord } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";
import type { PullSignals } from "./aggregate.js";
import type { QuestionSet, SignalModel, SignalRunRecord, SignalUnit, UnitAnswers } from "./types.js";
import { JEV_INPUT_USD_PER_MTOK } from "./types.js";
import { buildUnits, cacheKeyFor, evaluable } from "./units.js";
import type { ReplayFile } from "./replay.js";

/** Units + cached answers for one pull (no model calls). */
export async function loadPullSignals(
  store: PullStore,
  pull: Pick<PullRecord, "repoId" | "number" | "area">,
  qs: QuestionSet,
  modelId: string,
): Promise<PullSignals> {
  const hunks = await store.listHunks(pull.repoId, pull.number);
  const units = buildUnits(hunks, qs, { area: pull.area });
  const answers: Array<UnitAnswers | null> = [];
  for (const u of units) {
    if (!evaluable(u)) {
      answers.push(null);
      continue;
    }
    const cached = await store.getSignal(cacheKeyFor(modelId, qs.version, u));
    answers.push(cached ? cached.result : null);
  }
  return { pullNumber: pull.number, units, answers };
}

export interface RunSignalsOptions {
  /** Restrict to these pulls; default: all pulls in the repo. */
  readonly pullNumbers?: readonly number[];
  readonly openOnly?: boolean;
  /** Hard stop once estimated spend reaches this (USD). */
  readonly budgetUsd?: number;
  /** Units per model.evaluate call (the adapter handles its own concurrency). */
  readonly batchSize?: number;
  readonly now?: string;
}

export function costUsdFor(inputTokens: number): number {
  return (inputTokens / 1_000_000) * JEV_INPUT_USD_PER_MTOK;
}

export async function runSignals(
  store: PullStore,
  repoId: string,
  model: SignalModel,
  qs: QuestionSet,
  opts: RunSignalsOptions = {},
): Promise<SignalRunRecord> {
  const now = opts.now ?? new Date().toISOString();
  let pulls = await store.listPulls(repoId);
  if (opts.pullNumbers) {
    const want = new Set(opts.pullNumbers);
    pulls = pulls.filter((p) => want.has(p.number));
  }
  if (opts.openOnly) pulls = pulls.filter((p) => p.state === "open");

  let units = 0;
  let cached = 0;
  let notEvaluable = 0;
  const pending: Array<{ unit: SignalUnit; cacheKey: string }> = [];
  const seen = new Set<string>();
  for (const pull of pulls) {
    const hunks = await store.listHunks(repoId, pull.number);
    for (const u of buildUnits(hunks, qs, { area: pull.area })) {
      units += 1;
      if (!evaluable(u)) {
        notEvaluable += 1;
        continue;
      }
      const cacheKey = cacheKeyFor(model.id, qs.version, u);
      if (seen.has(cacheKey) || (await store.getSignal(cacheKey))) {
        cached += 1;
        continue;
      }
      seen.add(cacheKey);
      pending.push({ unit: u, cacheKey });
    }
  }

  const batchSize = opts.batchSize ?? 64;
  const budget = opts.budgetUsd ?? Number.POSITIVE_INFINITY;
  let inputTokens = 0;
  let evaluated = 0;
  let failed = 0;
  let skippedBudget = 0;
  const reported = new Set<string>();

  for (let i = 0; i < pending.length; i += batchSize) {
    if (costUsdFor(inputTokens) >= budget) {
      skippedBudget = pending.length - i;
      break;
    }
    const batch = pending.slice(i, i + batchSize);
    const results = await model.evaluate(
      batch.map((b) => b.unit),
      qs,
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j] ?? null;
      const { unit, cacheKey } = batch[j]!;
      if (!r) {
        failed += 1;
        continue;
      }
      evaluated += 1;
      inputTokens += r.inputTokens;
      reported.add(r.modelId);
      await store.upsertSignal({
        cacheKey,
        repoId,
        pullNumber: unit.pullNumber,
        unitKey: unit.key,
        modelId: model.id,
        questionSetVersion: qs.version,
        result: r,
        evaluatedAt: now,
      });
    }
  }

  const run: SignalRunRecord = {
    repoId,
    runAt: now,
    modelId: model.id,
    questionSetVersion: qs.version,
    pulls: pulls.length,
    units,
    cached,
    evaluated,
    failed,
    skippedBudget,
    notEvaluable,
    inputTokens,
    costUsd: Math.round(costUsdFor(inputTokens) * 1e6) / 1e6,
    reportedModelIds: [...reported].sort(),
  };
  await store.recordSignalRun(run);
  return run;
}

/**
 * A replay file covering every evaluable unit of the repo's pulls that has a
 * cached answer for `modelId` — cached before this run or not. Record with
 * this, not with a wrapper around one run, or previously cached units go missing.
 */
export async function exportReplayFile(
  store: PullStore,
  repoId: string,
  qs: QuestionSet,
  modelId: string,
  pullNumbers?: readonly number[],
): Promise<ReplayFile> {
  let pulls = await store.listPulls(repoId);
  if (pullNumbers) {
    const want = new Set(pullNumbers);
    pulls = pulls.filter((p) => want.has(p.number));
  }
  const entries = new Map<string, UnitAnswers>();
  for (const pull of pulls) {
    const signals = await loadPullSignals(store, pull, qs, modelId);
    signals.units.forEach((u, i) => {
      const a = signals.answers[i];
      if (a) entries.set(u.stateHash, a);
    });
  }
  return {
    kind: "pullup-jev-replay",
    modelId,
    questionSetVersion: qs.version,
    entries: Object.fromEntries([...entries.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}
