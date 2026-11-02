// The lint lane: Gallant-format rule files parsed as Gallant does, asked per
// changed file in a lane separate from the risk signals, and reported as
// raise-only findings.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planReviewActions } from "../actions/review.js";
import { configReportOptions, resolveConfig } from "../config/config.js";
import type { ConfigFile } from "../config/schema.js";
import { DEFAULT_INLINE } from "../config/inline.js";
import { planInline } from "../findings/inline.js";
import { ingestRepo } from "../ingest/pipeline.js";
import type { FixtureFile, SourcePull } from "../ingest/source.js";
import { createOverlayStore } from "../preview/overlay-store.js";
import { buildReport } from "../report/build.js";
import type { HunkRecord } from "../schema/domain.js";
import { InMemoryStore } from "../schema/store.js";
import { featureNames } from "../signals/aggregate.js";
import { hunkContentHash } from "../signals/hunks.js";
import { resolveQuestionSet } from "../signals/questions/custom.js";
import { runSignals } from "../signals/run.js";
import { sourceFromFixtureFile } from "../testing/hunks.js";
import { SyntheticSignalModel } from "../testing/synthetic-signals.js";
import type { LintRuleFile } from "./load.js";
import { buildLintRuleSet, isLintRulePath } from "./load.js";
import { globToNameRegExp, judgeViolation, parseLintRule, ruleApplies } from "./rules.js";
import { buildLintUnits, lintHunks, lintQuestionSet, runLint } from "./run.js";
import type { LintRuntime } from "./runtime.js";
import { storedLintRuleSet } from "./runtime.js";

const NOW = "2026-09-01T00:00:00.000Z";
const REPO = "fixtures/jev";
const base = JSON.parse(readFileSync(new URL("../../../../fixtures/jev.json", import.meta.url), "utf8")) as FixtureFile;
const gallant = (p: string) => readFileSync(new URL(`../../../../../../libraries/gallant/${p}`, import.meta.url), "utf8");
const hasGallant = (() => {
  try {
    gallant("README.md");
    return true;
  } catch {
    return false;
  }
})();

const NO_DEBUG = `---
appliesTo: "*.ts"
type: noul
---
Does this file violate the following rule?

# No debugging leftovers

Flag tracing such as \`console.log\` or \`debugger\` left in to inspect a value.
`;

const COMMENTS = `---
appliesTo: ["*.ts", "*.tsx"]
type: choice
criteria:
  useful: "The comments explain intent."
  useless: "The comments restate the code."
violation:
  if:
    useless: 0.5
pullupLevel: p1
---
Classify the comments. Comments that only repeat \`// increment\` are useless.
`;

const DOCS = `---
appliesTo: "*.md"
type: score
criteria:
  - "Easy to read"
  - "Very hard"
violation:
  if:
    "Very hard": 0.5
---
Rate how hard this document is to read. Words like \`utilize\` make it harder.
`;

function hunk(path: string, index: number, header: string, patch: string, pullNumber = 1): HunkRecord {
  const h = { path, index, header, patch, noPatch: false };
  return { repoId: REPO, pullNumber, ...h, contentHash: hunkContentHash(h) };
}

describe("lint rule parsing (Gallant's format)", () => {
  it("parses noul, choice and score rules, with Gallant's defaults", () => {
    const n = parseLintRule("no-debug.md", NO_DEBUG);
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.rule).toMatchObject({ id: "lint:no-debug.md", type: "noul", minConfidence: 0.5, appliesTo: ["*.ts"], violation: null, level: null });
    expect(n.rule.wireId).toMatch(/^r_[0-9a-f]{12}$/);
    expect(n.rule.body.startsWith("Does this file violate")).toBe(true);

    const c = parseLintRule("comments.md", COMMENTS);
    expect(c.ok && c.rule).toMatchObject({ type: "choice", level: "p1", options: { useful: "The comments explain intent.", useless: "The comments restate the code." }, violation: { if: { useless: 0.5 }, unless: {} } });

    const s = parseLintRule("docs.md", DOCS);
    expect(s.ok && s.rule).toMatchObject({ type: "score", levels: ["Easy to read", "Very hard"], minConfidence: 0 });
  });

  it.runIf(hasGallant)("accepts every example rule that ships with Gallant", () => {
    for (const p of [
      "examples/diff/rules/leftover-debugging.md",
      "examples/comments/rules/comments.md",
      "examples/json/rules/comments.md",
      "examples/readability/rules/readability.md",
      "examples/violation/rules/naming.md",
      "examples/ste100/rules/ste100.md",
      "examples/multiple/rules/useless-comments.md",
      "examples/multiple/rules/ignored-errors.md",
      "examples/stdin/rules/commit-message.md",
      "examples/over-extraction/rules/trivial-helpers.md",
      "rules/testdata/rules/severity.md",
    ]) {
      const r = parseLintRule(p, gallant(p));
      expect(r.ok ? "ok" : r.problem.message, p).toBe("ok");
    }
  });

  it("refuses an appliesTo glob with a folder part, which could never match a file name", () => {
    for (const g of ["**/*.ts", "src/*.go"]) {
      const r = parseLintRule("r.md", `---\ntype: noul\nappliesTo: '${g}'\n---\nx\n`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problem.message).toMatch(/file name only \(try "\*\.(ts|go)"\)/);
    }
  });

  it("rejects what Gallant rejects, with the reason", () => {
    const bad: Array<[string, RegExp]> = [
      ["no frontmatter\n", /missing frontmatter/],
      ["---\ntype: noul\n", /unclosed frontmatter/],
      ["---\ntype: maybe\nappliesTo: '*.go'\n---\nx\n", /invalid type/],
      ["---\ntype: choice\nappliesTo: '*.go'\n---\nx\n", /requires criteria options/],
      ["---\ntype: score\nappliesTo: '*.go'\ncriteria: [a, b]\nminConfidence: 0.7\n---\nx\n", /only supported for type noul/],
      ["---\ntype: noul\nappliesTo: '*.go'\nminConfidence: 2\n---\nx\n", /between 0 and 1/],
      ["---\ntype: noul\nappliesTo: '*.go'\nviolation:\n  if: {a: 0.5}\n---\nx\n", /use minConfidence for a noul/],
      ["---\ntype: choice\nappliesTo: '*.go'\ncriteria: {a: x, b: y}\nviolation:\n  if: {c: 0.5}\n---\nx\n", /unknown result "c"/],
      ["---\ntype: choice\nappliesTo: '*.go'\ncriteria: {a: x, b: y}\nviolation:\n  iff: {a: 0.5}\n---\nx\n", /unknown field "iff"/],
      ["---\ntype: noul\nappliesTo: '[a-'\n---\nx\n", /invalid appliesTo glob/],
      ["---\ntype: noul\nappliesTo: '*.go'\npullupLevel: p0\n---\nx\n", /capped at P1/],
      ["---\ntype: noul\nappliesTo: '*.go'\n---\n   \n", /no rule text/],
      ["---\ntype: noul\nappliesTo: '*.go'\n---\nhidden‮text\n", /invisible or bidi/],
      ["---\ntype: noul\n  bad: : yaml\n---\nx\n", /not valid YAML/],
    ];
    for (const [src, why] of bad) {
      const r = parseLintRule("r.md", src);
      expect(r.ok, src).toBe(false);
      if (!r.ok) expect(r.problem.message, src).toMatch(why);
    }
  });

  it("matches globs against the file name like Go's path.Match", () => {
    const m = (g: string, name: string) => globToNameRegExp(g)!.test(name);
    expect(m("*.go", "main.go")).toBe(true);
    expect(m("*.go", "main.go.txt")).toBe(false);
    expect(m("?.ts", "a.ts")).toBe(true);
    expect(m("[a-c]*.ts", "b1.ts")).toBe(true);
    expect(m("[^a-c]*.ts", "b1.ts")).toBe(false);
    expect(m("\\*.md", "*.md")).toBe(true);
    expect(m("\\*.md", "a.md")).toBe(false);
    for (const g of ["[", "[]", "[-a]", "a\\", "[z-a]"]) expect(globToNameRegExp(g), g).toBeNull();
    // The folder is not part of the match, as in Gallant.
    expect(ruleApplies({ appliesTo: ["*.ts"] }, "src/deep/x.ts")).toBe(true);
    expect(ruleApplies({ appliesTo: ["src/*.ts"] }, "src/x.ts")).toBe(false);
  });

  it("decides violations like Gallant: strictly above, unless cancels, name order on ties", () => {
    const v = { if: { useless: 0.5, mixed: 0.8 }, unless: { useful: 0.3 } };
    expect(judgeViolation(v, { useless: 0.6, useful: 0.2 })).toMatchObject({ fails: true, reason: "useless 0.6 > 0.5" });
    expect(judgeViolation(v, { useless: 0.5 }).fails).toBe(false);
    expect(judgeViolation(v, { useless: 0.6, useful: 0.31 })).toMatchObject({ fails: false, reason: "unless useful 0.31 > 0.3" });
    expect(judgeViolation(v, { useless: 0.9, mixed: 0.9 }).reason).toBe("mixed 0.9 > 0.8");
  });

  it("builds a rule set: Markdown only, hidden files skipped, rules that can never run listed as problems", () => {
    const files: LintRuleFile[] = [
      { path: "no-debug.md", content: NO_DEBUG },
      { path: "nested/comments.md", content: COMMENTS },
      { path: ".hidden/secret.md", content: NO_DEBUG },
      { path: "notes.txt", content: "x" },
      { path: "no-globs.md", content: "---\ntype: noul\n---\nDoes it?\n" },
      { path: "no-violation.md", content: "---\ntype: choice\nappliesTo: '*.ts'\ncriteria: {a: x, b: y}\n---\nPick.\n" },
    ];
    const set = buildLintRuleSet({ source: "fixture", ref: null, commitSha: null, dir: ".agents/gallant", files });
    expect(set.rules.map((r) => r.path)).toEqual(["nested/comments.md", "no-debug.md"]);
    expect(set.problems.map((p) => p.path)).toEqual(["no-globs.md", "no-violation.md"]);
    expect(isLintRulePath(".hidden/secret.md")).toBe(false);
    const again = buildLintRuleSet({ source: "fixture", ref: null, commitSha: null, dir: ".agents/gallant", files: [...files].reverse() });
    expect(again.hash).toBe(set.hash);
  });
});

describe("lint units (one per changed file)", () => {
  const set = buildLintRuleSet({ source: "fixture", ref: null, commitSha: null, dir: "r", files: [{ path: "no-debug.md", content: NO_DEBUG }, { path: "docs.md", content: DOCS }] });

  it("joins a file's hunks, skips files no rule applies to, and asks only the matching rules", () => {
    const units = buildLintUnits(
      [hunk("src/a.ts", 0, "@@ -1 +1 @@", "+a"), hunk("src/a.ts", 1, "@@ -9 +9 @@", "+b"), hunk("src/a.go", 0, "@@ -1 +1 @@", "+c"), hunk("README.md", 0, "@@ -1 +1 @@", "+d")],
      set,
      { area: "api" },
    );
    expect(units.map((u) => [u.key, u.hunkIndexes, u.rules.map((r) => r.path)])).toEqual([
      ["README.md#0", [0], ["docs.md"]],
      ["src/a.ts#0", [0, 1], ["no-debug.md"]],
    ]);
    expect(units[1]!.state.hunk).toBe("@@ -1 +1 @@\n+a\n@@ -9 +9 @@\n+b");
  });

  it("splits a large file at hunk boundaries and marks a file without a patch as not checkable", () => {
    const big = "+" + "x".repeat(800);
    const units = buildLintUnits(
      [hunk("src/a.ts", 0, "@@ -1 +1 @@", big), hunk("src/a.ts", 1, "@@ -5 +5 @@", big), { ...hunk("src/b.ts", 0, "", ""), noPatch: true }],
      set,
      { area: "api", tokenBudget: 400 },
    );
    expect(units.filter((u) => u.path === "src/a.ts").map((u) => u.hunkIndexes)).toEqual([[0], [1]]);
    expect(units.find((u) => u.path === "src/b.ts")!.noPatch).toBe(true);
  });

  it("versions the question set by the rules asked, so editing one rule leaves other files' answers cached", () => {
    const a = set.rules.find((r) => r.path === "no-debug.md")!;
    const edited = parseLintRule("no-debug.md", NO_DEBUG.replace("Flag tracing", "Flag any tracing"));
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(lintQuestionSet([a]).version).not.toBe(lintQuestionSet([edited.rule]).version);
    const docs = set.rules.find((r) => r.path === "docs.md")!;
    expect(lintQuestionSet([docs]).version).toBe(lintQuestionSet([docs]).version);
    expect(lintQuestionSet([a]).lane).toBe("lint");
  });
});

/** The jev fixture plus one open pull request with a debugging leftover, and rules on its default branch. */
function fixtureWithRules(rules: readonly LintRuleFile[]): FixtureFile {
  const debug: SourcePull = {
    number: 2001,
    title: "Add retry helper",
    author: "carol",
    createdAt: "2026-08-31T20:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    state: "open",
    baseBranch: "main",
    headSha: "cafe000000002001",
    additions: 3,
    deletions: 0,
    changedFiles: 1,
    labels: ["enhancement"],
    draft: false,
    files: ["src/ops/retry.ts"],
    hunks: [
      { path: "src/ops/retry.ts", index: 0, header: "@@ -1,2 +1,4 @@", patch: " export async function retry(fn) {\n+  console.log(\"retrying\", fn);\n+  return fn();\n }" },
      { path: "src/ops/retry.ts", index: 1, header: "@@ -20,2 +22,3 @@", patch: " // end\n+export const LIMIT = 3;\n" },
    ],
  };
  return { ...base, lintRules: { ".agents/gallant": rules }, pulls: [...base.pulls, debug] };
}

async function setup(file: ConfigFile, rules: readonly LintRuleFile[] = [{ path: "no-debug.md", content: NO_DEBUG }]) {
  const store = new InMemoryStore();
  await ingestRepo(sourceFromFixtureFile(fixtureWithRules(rules)), store, { now: NOW, repoId: REPO, lintRulesDir: ".agents/gallant" });
  const cfg = resolveConfig({ file });
  const model = new SyntheticSignalModel();
  const { ruleSet } = await storedLintRuleSet(store, REPO, cfg.lint);
  return { store, cfg, model, ruleSet };
}

async function reportWith(store: InMemoryStore, cfg: ReturnType<typeof resolveConfig>, lint: LintRuntime) {
  return buildReport(store, REPO, cfg.priors, {
    now: NOW,
    jev: { config: cfg.jev, policy: cfg.policy, qs: resolveQuestionSet(cfg.jev), modelId: lint.modelId, calibration: null, lint },
    ...configReportOptions(cfg),
  });
}

describe("lint lane end to end (fixture, synthetic model)", () => {
  it("reads rules on ingest, checks each file once, and adds a P2 note by default", async () => {
    const { store, cfg, model, ruleSet } = await setup({ lint: { mode: "on" } });
    expect(ruleSet.source).toBe("default-branch");
    expect(ruleSet.ref).toBe("main");
    expect(ruleSet.rules.map((r) => r.path)).toEqual(["no-debug.md"]);

    const run = await runLint(store, REPO, model, ruleSet, { openOnly: true, now: NOW });
    expect(run.questionSetVersion).toMatch(/^lint@/);
    const again = await runLint(store, REPO, model, ruleSet, { openOnly: true, now: NOW });
    expect(again.evaluated).toBe(0);
    expect(again.cached).toBe(run.evaluated);

    const report = await reportWith(store, cfg, { config: cfg.lint, ruleSet, modelId: model.id });
    expect(report.risk).toBeUndefined();
    expect(report.lint).toMatchObject({ mode: "on", rules: ["no-debug.md"], pullsWithHits: 1 });
    const d = report.decisions.find((x) => x.pullNumber === 2001)!;
    const f = d.findings!.find((x) => x.kind === "lint")!;
    expect(f).toMatchObject({ id: "lint:no-debug.md", level: "p2", source: "signal", title: "Lint: No debug", active: true, units: ["src/ops/retry.ts#0", "src/ops/retry.ts#1"] });
    expect(f.detail).toMatch(/^yes 0\.\d+ > 0\.5 · src\/ops\/retry\.ts#0/);
    expect(d.lint).toMatchObject({ mode: "on", evaluatedPaths: ["src/ops/retry.ts"] });
    // A clean pull gets no lint finding.
    expect(report.decisions.find((x) => x.pullNumber === 1004)!.findings!.some((x) => x.kind === "lint")).toBe(false);
  });

  it("a P1 rule asks for a human, but never requests changes on its own", async () => {
    const p1 = NO_DEBUG.replace("type: noul\n", "type: noul\npullupLevel: p1\n");
    const { store, cfg, model, ruleSet } = await setup({ lint: { mode: "on" }, severity: { actions: { p1: "request-changes" } } }, [{ path: "no-debug.md", content: p1 }]);
    await runLint(store, REPO, model, ruleSet, { now: NOW });
    const report = await reportWith(store, cfg, { config: cfg.lint, ruleSet, modelId: model.id });
    const [planned] = planReviewActions(
      report.decisions.filter((d) => d.pullNumber === 2001),
      await store.listPulls(REPO),
      { repoId: REPO, humanReviewers: ["alice"] },
    );
    expect(report.decisions.find((d) => d.pullNumber === 2001)!.findings!.find((x) => x.kind === "lint")!.level).toBe("p1");
    expect(planned!.action).toBe("defer_to_human");
    expect(planned!.reason).toMatch(/P1 Lint: No debug/);
  });

  it("observe mode shows findings without acting on them", async () => {
    const p1 = NO_DEBUG.replace("type: noul\n", "type: noul\npullupLevel: p1\n");
    const { store, cfg, model, ruleSet } = await setup({ lint: { mode: "observe" } }, [{ path: "no-debug.md", content: p1 }]);
    await runLint(store, REPO, model, ruleSet, { now: NOW });
    const report = await reportWith(store, cfg, { config: cfg.lint, ruleSet, modelId: model.id });
    const d = report.decisions.find((x) => x.pullNumber === 2001)!;
    expect(d.findings!.find((x) => x.kind === "lint")!.active).toBe(false);
    const off = await buildReport(store, REPO, cfg.priors, { now: NOW, ...configReportOptions(cfg) });
    const [withLint] = planReviewActions([d], await store.listPulls(REPO), { repoId: REPO });
    const [without] = planReviewActions(off.decisions.filter((x) => x.pullNumber === 2001), await store.listPulls(REPO), { repoId: REPO });
    expect(withLint?.action ?? null).toBe(without?.action ?? null);
  });

  it("leaves the risk lane alone: same question set, same cache, same calibration features", async () => {
    const { store, cfg, model, ruleSet } = await setup({ jev: { mode: "active" }, lint: { mode: "on" } });
    const qs = resolveQuestionSet(cfg.jev);
    const risk1 = await runSignals(store, REPO, model, qs, { now: NOW });
    await runLint(store, REPO, model, ruleSet, { now: NOW });
    // Edit the rule: only the lint lane re-asks.
    const edited = buildLintRuleSet({ ...ruleSet, files: [{ path: "no-debug.md", content: NO_DEBUG.replace("Flag tracing", "Flag all tracing") }] });
    const lint2 = await runLint(store, REPO, model, edited, { now: NOW });
    const risk2 = await runSignals(store, REPO, model, qs, { now: NOW });
    expect(lint2.evaluated).toBeGreaterThan(0);
    expect(risk2.evaluated).toBe(0);
    expect(risk2.cached).toBe(risk1.evaluated + risk1.cached);
    expect(qs.version).toBe(resolveQuestionSet({ ...cfg.jev }).version);
    expect(featureNames(qs).some((n) => n.includes("lint") || n.startsWith("max:r_"))).toBe(false);
  });

  it("a missing rules folder on the default branch clears the stored rules; a failing read keeps them", async () => {
    const { store } = await setup({ lint: { mode: "on" } });
    await ingestRepo({ ...sourceFromFixtureFile(base), readLintRules: async () => null }, store, { now: NOW, repoId: REPO, lintRulesDir: ".agents/gallant" });
    expect((await store.getLintRules(REPO))!.files).toEqual([]);
    const { store: s2 } = await setup({ lint: { mode: "on" } });
    await ingestRepo({ ...sourceFromFixtureFile(base), readLintRules: async () => Promise.reject(new Error("503")) }, s2, { now: NOW, repoId: REPO, lintRulesDir: ".agents/gallant" });
    expect((await s2.getLintRules(REPO))!.files).toHaveLength(1);
  });

  it("a preview's overlay store keeps rules it is given to itself", async () => {
    const { store } = await setup({ lint: { mode: "on" } });
    const overlay = createOverlayStore(store);
    await overlay.setLintRules({ repoId: REPO, source: "git-ref", ref: "origin/main", commitSha: null, dir: ".agents/gallant", files: [], fetchedAt: NOW });
    expect((await overlay.getLintRules(REPO))!.source).toBe("git-ref");
    expect((await store.getLintRules(REPO))!.source).toBe("default-branch");
  });
});

describe("lint and inline comments", () => {
  it("posts a lint comment when only lint ran, and resolves old ones only on files lint fully checked", async () => {
    const { store, cfg, model, ruleSet } = await setup({ lint: { mode: "on", level: "p1" }, inline: { enabled: true } });
    await runLint(store, REPO, model, ruleSet, { now: NOW });
    const report = await reportWith(store, cfg, { config: cfg.lint, ruleSet, modelId: model.id });
    const d = report.decisions.find((x) => x.pullNumber === 2001)!;
    const hunks = await store.listHunks(REPO, 2001);
    const plan = planInline({ config: { ...DEFAULT_INLINE, enabled: true }, findings: d.findings!, hunks, existing: [], headSha: "cafe000000002001", signalsRan: false, lintEvaluatedPaths: d.lint!.evaluatedPaths });
    expect(plan.post).toHaveLength(1);
    expect(plan.post[0]).toMatchObject({ findingId: "lint:no-debug.md", path: "src/ops/retry.ts", start_line: 1, line: 4 });
    expect(plan.post[0]!.body).toMatch(/lint rule `no-debug\.md` \(read from the default branch\) failed for this file/);
    expect(plan.post[0]!.body).toMatch(/Also flagged at 1 more place/);

    const existing = [
      { repoId: REPO, pullNumber: 2001, findingKey: "k-lint", findingId: "lint:old-rule.md", path: "src/ops/retry.ts", commentId: 1, firstHeadSha: "x", lastSeenHeadSha: "x", status: "open" as const, resolvedHeadSha: null, updatedAt: NOW },
      { repoId: REPO, pullNumber: 2001, findingKey: "k-lint-2", findingId: "lint:old-rule.md", path: "src/ops/other.ts", commentId: 2, firstHeadSha: "x", lastSeenHeadSha: "x", status: "open" as const, resolvedHeadSha: null, updatedAt: NOW },
      { repoId: REPO, pullNumber: 2001, findingKey: "k-risk", findingId: "signal:touchesAuthn", path: "src/ops/retry.ts", commentId: 3, firstHeadSha: "x", lastSeenHeadSha: "x", status: "open" as const, resolvedHeadSha: null, updatedAt: NOW },
    ];
    const later = planInline({ config: { ...DEFAULT_INLINE, enabled: true }, findings: [], hunks, existing, headSha: "cafe000000002002", signalsRan: false, lintEvaluatedPaths: ["src/ops/retry.ts"] });
    // The lint comment on a checked file is resolved; one on a removed file is too; the risk lane's comment is left alone (risk didn't run).
    expect(later.resolve.map((r) => [r.findingKey, r.why])).toEqual([
      ["k-lint", "fixed"],
      ["k-lint-2", "file-removed"],
    ]);
    const unchecked = planInline({ config: { ...DEFAULT_INLINE, enabled: true }, findings: [], hunks, existing, headSha: "cafe000000002002", signalsRan: false, lintEvaluatedPaths: [] });
    expect(unchecked.resolve.map((r) => r.findingKey)).toEqual(["k-lint-2"]);
  });
});

describe("lintHunks (local, before a push)", () => {
  it("returns failing rules with new-side line ranges, and reuses cached answers", async () => {
    const set = buildLintRuleSet({ source: "directory", ref: null, commitSha: null, dir: ".agents/gallant", files: [{ path: "no-debug.md", content: NO_DEBUG }, { path: "docs.md", content: DOCS }] });
    const hunks = [hunk("src/a.ts", 0, "@@ -3,2 +3,4 @@", "+  console.log(x);\n+  debugger;\n ok", 0), hunk("docs/a.md", 0, "@@ -1 +1,2 @@", "+We utilize the cache.", 0), hunk("src/b.ts", 0, "@@ -1 +1 @@", "+const y = 1;", 0)];
    const cache = new InMemoryStore();
    const model = new SyntheticSignalModel();
    const first = await lintHunks(model, set, hunks, { area: "api", cache });
    expect(first.failures.map((f) => [f.rulePath, f.path, f.lines])).toEqual([
      ["docs.md", "docs/a.md", [{ start: 1, end: 2 }]],
      ["no-debug.md", "src/a.ts", [{ start: 3, end: 6 }]],
    ]);
    expect(first.files).toBe(3);
    const second = await lintHunks(model, set, hunks, { area: "api", cache });
    expect(second.cached).toBe(3);
    expect(second.evaluated).toBe(0);
    expect(second.failures).toEqual(first.failures);
  });
});
