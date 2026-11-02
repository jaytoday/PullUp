// One-stop setup of the decision-model lanes for a report: resolve modes and
// the model, answer any uncached units for open PRs (budgeted), load the
// calibration artifact. The risk lane (Jev signals) and the lint lane (the
// repo's own lint rules) share the model but nothing else. Shared by the CLI,
// the server and the Eve tools so all behave identically.

import { existsSync } from "node:fs";
import { loadCalibration, resolveQuestionSet, runLint, runSignals, storedLintRuleSet } from "@pullup/core";
import type {
  CalibrationArtifact,
  JevMode,
  JevRuntime,
  LintMode,
  LintRuleSet,
  LintRuntime,
  PullStore,
  ResolvedConfig,
  SignalModel,
  SignalRunRecord,
} from "@pullup/core";
import type { SignalModelKind } from "./factory.js";
import { resolveSignalModel } from "./factory.js";

export interface PrepareOptions {
  readonly mode?: JevMode;
  /** Lint lane mode (default: config `lint.mode`). */
  readonly lintMode?: LintMode;
  /** Lint rules to use instead of the ones stored for the repo (a preview reads them at its base ref). */
  readonly lintRuleSet?: LintRuleSet;
  readonly kind?: SignalModelKind;
  readonly replayPath?: string;
  readonly calibrationPath?: string;
  readonly pullNumbers?: readonly number[];
  /** Evaluate uncached units before reporting (default true). */
  readonly evaluate?: boolean;
  readonly now?: string;
  /** A model to use instead of resolving one (tests). */
  readonly model?: SignalModel;
}

export interface PreparedJev {
  /** Null only when both lanes are off. With only lint on, `config.mode` is "off" and `lint` is set. */
  readonly runtime: JevRuntime | null;
  readonly run: SignalRunRecord | null;
  readonly lintRun: SignalRunRecord | null;
}

function runNotes(run: SignalRunRecord, budgetUsd: number, modelId: string, lane: string): string[] {
  const notes: string[] = [];
  if (run.skippedBudget > 0) notes.push(`${lane}: budget $${budgetUsd} reached: ${run.skippedBudget} unit(s) left unevaluated.`);
  if (run.failed > 0) notes.push(`${lane}: ${run.failed} unit(s) failed to evaluate (treated as unknown).`);
  const drift = run.reportedModelIds.filter((m) => m !== modelId);
  if (drift.length > 0) notes.push(`Provider reported model ${drift.join(", ")} ≠ pinned ${modelId}.`);
  return notes;
}

export async function prepareJevRuntime(
  store: PullStore,
  repoId: string,
  cfg: ResolvedConfig,
  opts: PrepareOptions = {},
): Promise<PreparedJev> {
  const config = { ...cfg.jev, mode: opts.mode ?? cfg.jev.mode };
  const lintConfig = { ...cfg.lint, mode: opts.lintMode ?? cfg.lint.mode };
  const riskOn = config.mode !== "off";
  const lintOn = lintConfig.mode !== "off";
  if (!riskOn && !lintOn) return { runtime: null, run: null, lintRun: null };

  const qs = resolveQuestionSet(config);
  const resolved = opts.model ? { model: opts.model, note: null } : resolveSignalModel({ kind: opts.kind, replayPath: opts.replayPath, config });
  const model = resolved.model;
  const notes: string[] = resolved.note ? [resolved.note] : [];
  const scope = { openOnly: opts.pullNumbers === undefined, pullNumbers: opts.pullNumbers, now: opts.now };

  let run: SignalRunRecord | null = null;
  let calibration: CalibrationArtifact | null = null;
  if (riskOn) {
    if (opts.evaluate ?? true) {
      run = await runSignals(store, repoId, model, qs, { ...scope, budgetUsd: config.budgetUsdPerRun });
      notes.push(...runNotes(run, config.budgetUsdPerRun, model.id, "Risk signals"));
    }
    const calibrationPath = opts.calibrationPath ?? config.calibrationPath;
    if (calibrationPath) {
      if (existsSync(calibrationPath)) calibration = loadCalibration(calibrationPath);
      else notes.push(`Calibration file ${calibrationPath} not found.`);
    }
  }

  let lint: LintRuntime | undefined;
  let lintRun: SignalRunRecord | null = null;
  if (lintOn) {
    const lintNotes: string[] = [];
    let ruleSet = opts.lintRuleSet;
    if (!ruleSet) {
      const stored = await storedLintRuleSet(store, repoId, lintConfig);
      ruleSet = stored.ruleSet;
      lintNotes.push(...stored.notes);
    }
    if (ruleSet.problems.length > 0) lintNotes.push(`${ruleSet.problems.length} lint rule file(s) not used: ${ruleSet.problems.map((p) => `${p.path} (${p.message})`).join("; ")}.`);
    if ((opts.evaluate ?? true) && ruleSet.rules.length > 0) {
      lintRun = await runLint(store, repoId, model, ruleSet, { ...scope, budgetUsd: lintConfig.budgetUsdPerRun });
      lintNotes.push(...runNotes(lintRun, lintConfig.budgetUsdPerRun, model.id, "Lint"));
    }
    lint = { config: lintConfig, ruleSet, modelId: model.id, notes: lintNotes };
  }

  return {
    runtime: { config, policy: cfg.policy, qs, modelId: model.id, calibration, notes, ...(lint ? { lint } : {}) },
    run,
    lintRun,
  };
}
