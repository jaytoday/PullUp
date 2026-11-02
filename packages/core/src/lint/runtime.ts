// The resolved lint lane handed to buildReport: config + the rule set + the
// model id whose cached answers to read. Like the risk lane, assessment reads
// only cached answers.

import type { LintConfig } from "../config/lint.js";
import type { PullStore } from "../schema/store.js";
import type { LintRuleSet } from "./load.js";
import { buildLintRuleSet } from "./load.js";
import type { LintPullResult } from "./run.js";
import { assessLintPull } from "./run.js";

export interface LintRuntime {
  readonly config: LintConfig;
  readonly ruleSet: LintRuleSet;
  readonly modelId: string;
  readonly notes?: readonly string[];
}

export interface LintSummary {
  readonly mode: Exclude<LintConfig["mode"], "off">;
  readonly modelId: string;
  readonly source: LintRuleSet["source"];
  readonly ref: string | null;
  readonly commitSha: string | null;
  readonly dir: string;
  readonly ruleSetHash: string;
  readonly rules: readonly string[];
  readonly problems: LintRuleSet["problems"];
  readonly units: { readonly total: number; readonly evaluated: number };
  /** Open pulls with at least one failing rule. */
  readonly pullsWithHits: number;
  readonly notes: readonly string[];
}

/** The rule set the store holds for a repo, or an empty one (with a note) when none was read yet. */
export async function storedLintRuleSet(store: PullStore, repoId: string, cfg: LintConfig): Promise<{ ruleSet: LintRuleSet; notes: string[] }> {
  const snap = await store.getLintRules(repoId);
  const notes: string[] = [];
  if (!snap) {
    notes.push(`No lint rules stored for ${repoId}: ingest from GitHub (reads ${cfg.dir} on the default branch) or run \`pullup lint-rules sync\`.`);
    return { ruleSet: buildLintRuleSet({ source: "default-branch", ref: null, commitSha: null, dir: cfg.dir, files: [] }), notes };
  }
  if (snap.dir !== cfg.dir) {
    notes.push(`Stored lint rules were read from ${snap.dir}, but lint.dir is ${cfg.dir}: re-ingest or re-sync to pick up the new folder.`);
  }
  return { ruleSet: buildLintRuleSet(snap), notes };
}

export async function assessLintOpenPulls(
  store: PullStore,
  repoId: string,
  rt: LintRuntime,
): Promise<{ results: Map<number, LintPullResult>; summary: LintSummary }> {
  const pulls = (await store.listPulls(repoId)).filter((p) => p.state === "open");
  const results = new Map<number, LintPullResult>();
  let total = 0;
  let evaluated = 0;
  for (const pull of pulls) {
    const r = await assessLintPull(store, pull, rt.ruleSet, rt.modelId);
    results.set(pull.number, r);
    total += r.unitsTotal;
    evaluated += r.unitsEvaluated;
  }
  const notes = [...(rt.notes ?? [])];
  if (evaluated < total) notes.push(`${total - evaluated}/${total} lint unit(s) have no cached answers or cannot be checked — run \`pullup signals\`.`);
  return {
    results,
    summary: {
      mode: rt.config.mode as LintSummary["mode"],
      modelId: rt.modelId,
      source: rt.ruleSet.source,
      ref: rt.ruleSet.ref,
      commitSha: rt.ruleSet.commitSha,
      dir: rt.ruleSet.dir,
      ruleSetHash: rt.ruleSet.hash,
      rules: rt.ruleSet.rules.map((r) => r.path),
      problems: rt.ruleSet.problems,
      units: { total, evaluated },
      pullsWithHits: [...results.values()].filter((r) => r.hits.length > 0).length,
      notes,
    },
  };
}
