// The lint lane: the repo's lint rules asked of the decision model, one call
// per changed file (Gallant's unit), with only the rules whose globs match
// that file. Answers share the content-addressed signal cache, keyed by a
// lint question-set version made from the rules asked, so editing one rule
// re-asks only the files it applies to and never touches the risk lane's
// answers or its calibration.
//
// Reading results (`assessLintPull`) never calls a model: it reads cached answers,
// like the risk lane's assessment.

import type { HunkRecord, PullRecord } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";
import { fnv1a } from "../signals/questions/custom.js";
import { costUsdFor } from "../signals/run.js";
import type { Answer, QuestionSet, QuestionSpec, SignalModel, SignalRunRecord, SignalUnit, UnitAnswers } from "../signals/types.js";
import { DEFAULT_UNIT_TOKEN_BUDGET, buildUnits, cacheKeyFor, estimateTokens, evaluable, statePayload } from "../signals/units.js";
import { sha256 } from "../signals/hunks.js";
import type { LintRuleSet } from "./load.js";
import type { LintRule, LintVerdict } from "./rules.js";
import { judgeViolation, ruleApplies } from "./rules.js";

/** A lint unit: one changed file, or one part of a large one. */
export interface LintUnit extends SignalUnit {
  /** The hunks this unit covers (their `index` in the file). */
  readonly hunkIndexes: readonly number[];
  /** Rules asked about this unit. */
  readonly rules: readonly LintRule[];
}

/** The model-facing question for one rule: Gallant sends the rule text as the question, as written. */
export function lintQuestion(rule: LintRule): QuestionSpec {
  if (rule.type === "choice") return { kind: "choice", text: rule.body, options: { ...rule.options! } };
  if (rule.type === "score") return { kind: "score", text: rule.body, levels: [...rule.levels!] };
  return { kind: "noul", text: rule.body };
}

/** The question set for a group of rules. Its version names exactly these rules' contents. */
export function lintQuestionSet(rules: readonly LintRule[]): QuestionSet {
  const sorted = [...rules].sort((a, b) => (a.wireId < b.wireId ? -1 : 1));
  return {
    version: `lint-${fnv1a(sorted.map((r) => `${r.wireId}:${r.hash}`).join("|"))}`,
    lane: "lint",
    questions: Object.fromEntries(sorted.map((r) => [r.wireId, lintQuestion(r)])),
    sensitive: [],
    escalating: [],
    lowRisk: [],
    injection: "",
    changeKind: "",
    lowRiskKinds: [],
    blastRadius: "",
  };
}

function hunkText(h: HunkRecord): string {
  return h.header ? `${h.header}\n${h.patch}` : h.patch;
}

/**
 * Lint units for one pull: one per changed file that has at least one
 * applicable rule. Hunks of a file are joined in order while they fit the
 * token budget; a larger file is split at hunk boundaries, and a single hunk
 * that alone is too large is split on lines like the risk lane's units.
 */
export function buildLintUnits(
  hunks: readonly HunkRecord[],
  ruleSet: Pick<LintRuleSet, "rules">,
  opts: { readonly area: string; readonly tokenBudget?: number },
): LintUnit[] {
  const byPath = new Map<string, HunkRecord[]>();
  for (const h of [...hunks].sort((a, b) => (a.path === b.path ? a.index - b.index : a.path < b.path ? -1 : 1))) {
    byPath.set(h.path, [...(byPath.get(h.path) ?? []), h]);
  }
  const units: LintUnit[] = [];
  for (const [path, fileHunks] of byPath) {
    const rules = ruleSet.rules.filter((r) => ruleApplies(r, path));
    if (rules.length === 0) continue;
    const qs = lintQuestionSet(rules);
    const longest = Math.max(...Object.values(qs.questions).map((q) => estimateTokens(q.text + JSON.stringify("options" in q ? q.options : "levels" in q ? q.levels : ""))));
    const budget = (opts.tokenBudget ?? DEFAULT_UNIT_TOKEN_BUDGET) - longest;
    const overhead = estimateTokens(path + opts.area) + 16;
    const make = (text: string, indexes: number[], part: number, flags: { noPatch: boolean; oversize: boolean }): LintUnit => {
      const state = { path, area: opts.area, hunk: text };
      return {
        key: part === 0 ? `${path}#${indexes[0]}` : `${path}#${indexes[0]}.${part}`,
        pullNumber: fileHunks[0]!.pullNumber,
        path,
        hunkIndex: indexes[0]!,
        part,
        state,
        stateHash: sha256(statePayload(state)),
        hunkIndexes: indexes,
        rules,
        ...flags,
      };
    };
    if (fileHunks.some((h) => h.noPatch)) {
      units.push(make("", fileHunks.map((h) => h.index), 0, { noPatch: true, oversize: false }));
      continue;
    }
    let buf: string[] = [];
    let idx: number[] = [];
    let tokens = 0;
    let part = 0;
    const flush = () => {
      if (buf.length === 0) return;
      units.push(make(buf.join("\n"), idx, part++, { noPatch: false, oversize: false }));
      buf = [];
      idx = [];
      tokens = 0;
    };
    for (const h of fileHunks) {
      const text = hunkText(h);
      const t = estimateTokens(text + "\n");
      if (t + overhead > budget) {
        // Too large on its own: the risk lane's line split, re-carrying the hunk header.
        flush();
        for (const u of buildUnits([h], qs, { area: opts.area, tokenBudget: opts.tokenBudget })) {
          units.push(make(u.state.hunk, [h.index], part++, { noPatch: u.noPatch, oversize: u.oversize }));
        }
        continue;
      }
      if (tokens + t + overhead > budget) flush();
      buf.push(text);
      idx.push(h.index);
      tokens += t;
    }
    flush();
  }
  return units;
}

function groupKey(rules: readonly LintRule[]): string {
  return lintQuestionSet(rules).version;
}

export interface RunLintOptions {
  readonly pullNumbers?: readonly number[];
  readonly openOnly?: boolean;
  readonly budgetUsd?: number;
  readonly now?: string;
}

/** Answers every uncached lint unit (budgeted) and records the run. */
export async function runLint(
  store: PullStore,
  repoId: string,
  model: SignalModel,
  ruleSet: LintRuleSet,
  opts: RunLintOptions = {},
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
  const groups = new Map<string, { qs: QuestionSet; items: Array<{ unit: LintUnit; cacheKey: string }> }>();
  const seen = new Set<string>();
  for (const pull of pulls) {
    if (ruleSet.rules.length === 0) break;
    const hunks = await store.listHunks(repoId, pull.number);
    for (const u of buildLintUnits(hunks, ruleSet, { area: pull.area })) {
      units += 1;
      if (!evaluable(u)) {
        notEvaluable += 1;
        continue;
      }
      const qs = lintQuestionSet(u.rules);
      const cacheKey = cacheKeyFor(model.id, qs.version, u);
      if (seen.has(cacheKey) || (await store.getSignal(cacheKey))) {
        cached += 1;
        continue;
      }
      seen.add(cacheKey);
      const g = groups.get(qs.version) ?? { qs, items: [] };
      g.items.push({ unit: u, cacheKey });
      groups.set(qs.version, g);
    }
  }

  const budget = opts.budgetUsd ?? Number.POSITIVE_INFINITY;
  let inputTokens = 0;
  let evaluated = 0;
  let failed = 0;
  let skippedBudget = 0;
  const reported = new Set<string>();
  const batchSize = 64;
  const ordered = [...groups.values()].sort((a, b) => (a.qs.version < b.qs.version ? -1 : 1));
  for (const g of ordered) {
    for (let i = 0; i < g.items.length; i += batchSize) {
      if (costUsdFor(inputTokens) >= budget) {
        skippedBudget += g.items.length - i;
        break;
      }
      const batch = g.items.slice(i, i + batchSize);
      const results = await model.evaluate(
        batch.map((b) => b.unit),
        g.qs,
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
          questionSetVersion: g.qs.version,
          result: r,
          evaluatedAt: now,
        });
      }
    }
  }

  const run: SignalRunRecord = {
    repoId,
    runAt: now,
    modelId: model.id,
    questionSetVersion: `lint@${ruleSet.hash.slice(0, 12)}`,
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

/** Judges one rule against one answer. Missing or mistyped answers never fail a rule. */
export function judgeRule(rule: LintRule, answer: Answer | undefined): LintVerdict | null {
  if (!answer) return null;
  if (rule.type === "noul") {
    if (answer.kind !== "noul") return null;
    return answer.p > rule.minConfidence
      ? { fails: true, reason: `yes ${round(answer.p)} > ${rule.minConfidence}`, p: answer.p }
      : { fails: false, reason: `yes ${round(answer.p)} ≤ ${rule.minConfidence}`, p: answer.p };
  }
  if (answer.kind !== rule.type || !rule.violation) return null;
  // Score probabilities are keyed by level number; rules name levels.
  const prob: Record<string, number> =
    answer.kind === "score"
      ? Object.fromEntries(Object.entries(answer.probabilities).map(([k, p]) => [rule.levels![Number(k)] ?? k, p]))
      : { ...answer.probabilities };
  return judgeViolation(rule.violation, prob);
}

const round = (p: number) => Math.round(p * 10_000) / 10_000;

/** One failing rule on one pull. */
export interface LintHit {
  readonly ruleId: string;
  readonly rulePath: string;
  /** The rule's own level, or null to use the config's. */
  readonly level: LintRule["level"];
  /** The strongest failing unit's reason. */
  readonly reason: string;
  readonly p: number;
  /** One key per covered hunk (`path#index`), so the finding can be pinned to diff lines. */
  readonly units: readonly string[];
  readonly paths: readonly string[];
}

export interface LintPullResult {
  readonly pullNumber: number;
  readonly hits: readonly LintHit[];
  /** Files whose every lint unit has an answer, or that no rule applies to (safe to resolve old lint comments on). */
  readonly evaluatedPaths: readonly string[];
  readonly unitsTotal: number;
  readonly unitsEvaluated: number;
}

/** Cached lint answers for one pull, judged. No model calls. */
export async function assessLintPull(
  store: PullStore,
  pull: Pick<PullRecord, "repoId" | "number" | "area">,
  ruleSet: LintRuleSet,
  modelId: string,
): Promise<LintPullResult> {
  const hunks = await store.listHunks(pull.repoId, pull.number);
  const units = buildLintUnits(hunks, ruleSet, { area: pull.area });
  const byRule = new Map<string, { rule: LintRule; best: LintVerdict; units: string[]; paths: Set<string> }>();
  const missing = new Set<string>();
  let evaluatedCount = 0;
  for (const u of units) {
    if (!evaluable(u)) {
      missing.add(u.path);
      continue;
    }
    const cached = await store.getSignal(cacheKeyFor(modelId, groupKey(u.rules), u));
    const answers: UnitAnswers | null = cached ? cached.result : null;
    if (!answers) {
      missing.add(u.path);
      continue;
    }
    evaluatedCount += 1;
    for (const rule of u.rules) {
      const v = judgeRule(rule, answers.answers[rule.wireId]);
      if (!v?.fails) continue;
      const entry = byRule.get(rule.id) ?? { rule, best: v, units: [], paths: new Set<string>() };
      if (v.p > entry.best.p) entry.best = v;
      for (const i of u.hunkIndexes) {
        const key = `${u.path}#${i}`;
        if (!entry.units.includes(key)) entry.units.push(key);
      }
      entry.paths.add(u.path);
      byRule.set(rule.id, entry);
    }
  }
  const hits: LintHit[] = [...byRule.values()]
    .map((e) => ({
      ruleId: e.rule.id,
      rulePath: e.rule.path,
      level: e.rule.level,
      reason: e.best.reason,
      p: round(e.best.p),
      units: e.units,
      paths: [...e.paths].sort(),
    }))
    .sort((a, b) => (a.ruleId < b.ruleId ? -1 : 1));
  // A file no rule applies to is trivially checked: an old lint comment there can be resolved.
  const allPaths = [...new Set(hunks.map((h) => h.path))];
  return {
    pullNumber: pull.number,
    hits,
    evaluatedPaths: allPaths.filter((p) => !missing.has(p)).sort(),
    unitsTotal: units.length,
    unitsEvaluated: evaluatedCount,
  };
}

/** One failing rule on one file, located on the new side of the diff. */
export interface LocalLintFailure {
  readonly ruleId: string;
  readonly rulePath: string;
  readonly path: string;
  /** New-side line ranges of the hunks in the failing unit. */
  readonly lines: ReadonlyArray<{ readonly start: number; readonly end: number }>;
  readonly reason: string;
  readonly p: number;
  readonly level: LintRule["level"];
}

export interface LocalLintResult {
  readonly rules: number;
  readonly files: number;
  readonly units: number;
  readonly evaluated: number;
  readonly cached: number;
  readonly failed: number;
  readonly notEvaluable: number;
  readonly inputTokens: number;
  readonly costUsd: number;
  readonly failures: readonly LocalLintFailure[];
}

const HEADER_NEW = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Lints a set of hunks directly (a local branch before it is pushed): no
 * pull request, no decision, just which rules fail where. Answers go through
 * the same content-addressed cache when one is given, so a later pull request
 * with the same changes reuses them.
 */
export async function lintHunks(
  model: SignalModel,
  ruleSet: LintRuleSet,
  hunks: readonly HunkRecord[],
  opts: { readonly area: string; readonly cache?: Pick<PullStore, "getSignal" | "upsertSignal">; readonly repoId?: string; readonly now?: string },
): Promise<LocalLintResult> {
  const units = buildLintUnits(hunks, ruleSet, { area: opts.area });
  const byIndex = new Map(hunks.map((h) => [`${h.path}#${h.index}`, h]));
  const failures: LocalLintFailure[] = [];
  let evaluated = 0;
  let cached = 0;
  let failed = 0;
  let notEvaluable = 0;
  let inputTokens = 0;
  for (const u of units) {
    if (!evaluable(u)) {
      notEvaluable += 1;
      continue;
    }
    const qs = lintQuestionSet(u.rules);
    const cacheKey = cacheKeyFor(model.id, qs.version, u);
    let answers = (await opts.cache?.getSignal(cacheKey))?.result ?? null;
    if (answers) cached += 1;
    else {
      [answers = null] = await model.evaluate([u], qs);
      if (!answers) {
        failed += 1;
        continue;
      }
      evaluated += 1;
      inputTokens += answers.inputTokens;
      await opts.cache?.upsertSignal({
        cacheKey,
        repoId: opts.repoId ?? "local",
        pullNumber: u.pullNumber,
        unitKey: u.key,
        modelId: model.id,
        questionSetVersion: qs.version,
        result: answers,
        evaluatedAt: opts.now ?? new Date().toISOString(),
      });
    }
    for (const rule of u.rules) {
      const v = judgeRule(rule, answers.answers[rule.wireId]);
      if (!v?.fails) continue;
      const lines = u.hunkIndexes.flatMap((i) => {
        const m = HEADER_NEW.exec(byIndex.get(`${u.path}#${i}`)?.header ?? "");
        if (!m) return [];
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        return [{ start, end: Math.max(start, start + count - 1) }];
      });
      failures.push({ ruleId: rule.id, rulePath: rule.path, path: u.path, lines, reason: v.reason, p: round(v.p), level: rule.level });
    }
  }
  return {
    rules: ruleSet.rules.length,
    files: new Set(units.map((u) => u.path)).size,
    units: units.length,
    evaluated,
    cached,
    failed,
    notEvaluable,
    inputTokens,
    costUsd: Math.round(costUsdFor(inputTokens) * 1e6) / 1e6,
    failures: failures.sort((a, b) => (a.path === b.path ? (a.ruleId < b.ruleId ? -1 : 1) : a.path < b.path ? -1 : 1)),
  };
}
