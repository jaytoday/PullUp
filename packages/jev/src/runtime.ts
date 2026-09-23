// One-stop setup of the Jev layer for a report: resolve mode + model, answer
// any uncached units for open PRs (budgeted), load the calibration artifact.
// Shared by the CLI and the Eve tools so both behave identically.

import { existsSync } from "node:fs";
import { QUESTION_SETS, loadCalibration, runSignals } from "@pullup/core";
import type {
  CalibrationArtifact,
  JevMode,
  JevRuntime,
  PullStore,
  ResolvedConfig,
  SignalRunRecord,
} from "@pullup/core";
import type { SignalModelKind } from "./factory.js";
import { resolveSignalModel } from "./factory.js";

export interface PrepareOptions {
  readonly mode?: JevMode;
  readonly kind?: SignalModelKind;
  readonly replayPath?: string;
  readonly calibrationPath?: string;
  readonly pullNumbers?: readonly number[];
  /** Evaluate uncached units before reporting (default true). */
  readonly evaluate?: boolean;
  readonly now?: string;
}

export interface PreparedJev {
  readonly runtime: JevRuntime | null;
  readonly run: SignalRunRecord | null;
}

export async function prepareJevRuntime(
  store: PullStore,
  repoId: string,
  cfg: ResolvedConfig,
  opts: PrepareOptions = {},
): Promise<PreparedJev> {
  const config = { ...cfg.jev, mode: opts.mode ?? cfg.jev.mode };
  if (config.mode === "off") return { runtime: null, run: null };

  const qs = QUESTION_SETS[config.questionSet];
  if (!qs) throw new Error(`Unknown question set "${config.questionSet}".`);

  const { model, note } = resolveSignalModel({
    kind: opts.kind,
    replayPath: opts.replayPath,
    config,
  });
  const notes: string[] = note ? [note] : [];

  let run: SignalRunRecord | null = null;
  if (opts.evaluate ?? true) {
    run = await runSignals(store, repoId, model, qs, {
      openOnly: opts.pullNumbers === undefined,
      pullNumbers: opts.pullNumbers,
      budgetUsd: config.budgetUsdPerRun,
      now: opts.now,
    });
    if (run.skippedBudget > 0) {
      notes.push(`Budget $${config.budgetUsdPerRun} reached: ${run.skippedBudget} unit(s) left unevaluated.`);
    }
    if (run.failed > 0) notes.push(`${run.failed} unit(s) failed to evaluate (treated as unknown risk).`);
    const drift = run.reportedModelIds.filter((m) => m !== model.id);
    if (drift.length > 0) notes.push(`Provider reported model ${drift.join(", ")} ≠ pinned ${model.id}.`);
  }

  const calibrationPath = opts.calibrationPath ?? config.calibrationPath;
  let calibration: CalibrationArtifact | null = null;
  if (calibrationPath) {
    if (existsSync(calibrationPath)) calibration = loadCalibration(calibrationPath);
    else notes.push(`Calibration file ${calibrationPath} not found.`);
  }

  return {
    runtime: { config, policy: cfg.policy, qs, modelId: model.id, calibration, notes },
    run,
  };
}
