// The parser tests are copied from PullUp (code/pullup) packages/core/src/lint/lint.test.ts at commit a399ffc.
import { readFileSync } from "node:fs";
import type { ScreenAnswer } from "@pullup/sdk";
import { describe, expect, it } from "vitest";
import { testContext } from "../test-context";
import repoRules, { breaks, loadRules } from ".";
import { globToNameRegExp, judgeViolation, parseLintRule, ruleApplies } from "./rules";

const gallant = (p: string) => readFileSync(new URL(`./testdata/gallant/${p}`, import.meta.url), "utf8");

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

describe("lint rule parsing (Gallant's format)", () => {
  it("parses noul, choice and score rules, with Gallant's defaults", () => {
    const n = parseLintRule("no-debug.md", NO_DEBUG);
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.rule).toMatchObject({ key: "no-debug", type: "noul", minConfidence: 0.5, appliesTo: ["*.ts"], violation: null, level: null, councilMayPass: true });
    expect(n.rule.body.startsWith("Does this file violate")).toBe(true);

    const c = parseLintRule("comments.md", COMMENTS);
    expect(c.ok && c.rule).toMatchObject({ type: "choice", level: "p1", options: { useful: "The comments explain intent.", useless: "The comments restate the code." }, violation: { if: { useless: 0.5 }, unless: {} } });

    const s = parseLintRule("docs.md", DOCS);
    expect(s.ok && s.rule).toMatchObject({ type: "score", levels: ["Easy to read", "Very hard"], minConfidence: 0 });
  });

  it("accepts every example rule that ships with Gallant", () => {
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
      ["---\ntype: noul\nappliesTo: '*.go'\npullupCouncilMayPass: maybe\n---\nx\n", /must be true or false/],
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

});

const config = repoRules.config.schema.parse({});
const files = [
  { path: ".pullup/rules/no-debug.md", text: NO_DEBUG, from: "default" as const },
  { path: ".pullup/rules/style/comments.md", text: COMMENTS, from: "default" as const },
  { path: ".pullup/rules/broken.md", text: "no frontmatter", from: "default" as const },
  { path: ".pullup/rules/.draft.md", text: NO_DEBUG, from: "default" as const },
];
const DIFF = "--- a/src/cart.ts\n+++ b/src/cart.ts\n@@ -1,1 +1,2 @@\n const total = 1;\n+console.log(total);\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-a\n+b\n";
const answer = (key: string, result: string, confidence: number, quote: string | null = null): ScreenAnswer => ({
  key, status: "answered", result, confidence, reason: `${result} because`, quotes: quote ? [{ text: quote, line: 2, file: "src/cart.ts" }] : [], why: null,
});

describe("repo-rules", () => {
  it("loads Markdown rules from the folder, skips hidden files, and lists broken ones", () => {
    const { rules, problems } = loadRules(files, ".pullup/rules");
    expect(rules.map((r) => r.key)).toEqual(["no-debug", "style.comments"]);
    expect(problems).toEqual(["broken.md missing frontmatter: a rule must begin with a --- block"]);
  });

  it("asks one screen per rule and changed file it applies to (by file name)", () => {
    const screens = repoRules.screens!(testContext(config, { diff: DIFF, files }));
    expect(screens.map((s) => [s.key, s.file, s.options])).toEqual([
      ["no-debug:0", "src/cart.ts", ["yes", "no"]],
      ["style.comments:0", "src/cart.ts", ["useful", "useless"]],
    ]);
    expect(screens[1]!.needsQuote).toEqual(["useless"]);
    expect(screens[0]!.guidance).toContain("# No debugging leftovers");
  });

  it("a rule that fails raises a question with the quoted line; a rule that holds raises nothing", () => {
    const ctx = testContext(config, { diff: DIFF, files }, [answer("no-debug:0", "yes", 0.9, "console.log(total);"), answer("style.comments:0", "useful", 0.8)]);
    const { questions } = repoRules.detect!(ctx);
    expect(questions).toHaveLength(1);
    expect(questions![0]).toMatchObject({ key: "no-debug", councilMayPass: true, evidence: [{ source: "diff", where: "src/cart.ts", line: 2, text: "console.log(total);" }] });
    expect(questions![0]!.seatContext).toContain("No debugging leftovers");
  });

  it("decides like Gallant: strictly above minConfidence, and a choice rule's violation clause", () => {
    const [noul, choice] = loadRules(files, ".pullup/rules").rules;
    expect(breaks(noul!, answer("k", "yes", 0.5)).fails).toBe(false);
    expect(breaks(noul!, answer("k", "yes", 0.51)).fails).toBe(true);
    expect(breaks(noul!, answer("k", "no", 0.4)).fails).toBe(true);
    expect(breaks(choice!, answer("k", "useless", 0.7)).fails).toBe(true);
    expect(breaks(choice!, answer("k", "useless", 0.5)).fails).toBe(false);
    expect(breaks(noul!, { ...answer("k", "yes", 1), status: "not-checked", result: null }).fails).toBe(false);
  });

  it("a file that could not be checked is a question with failClosed (the default), and a note either way", () => {
    const notChecked: ScreenAnswer = { key: "no-debug:0", status: "not-checked", result: null, confidence: 0, reason: "", quotes: [], why: "the call failed: timeout" };
    const ctx = testContext(config, { diff: DIFF, files }, [notChecked, answer("style.comments:0", "useful", 0.9)]);
    expect(repoRules.detect!(ctx).questions!.map((q) => [q.key, q.summary])).toEqual([["not-checked", "Not checked: no-debug.md on src/cart.ts (the call failed: timeout)."]]);
    expect(repoRules.notes!(ctx).map((n) => n.text)).toContain("1 rule check(s) could not run: the call failed: timeout.");
    const open = testContext({ ...config, failClosed: false }, { diff: DIFF, files }, [notChecked]);
    expect(repoRules.detect!(open).questions).toEqual([]);
  });

  it("a rule can make itself person-only, but cannot loosen the repository's setting", () => {
    const strict = NO_DEBUG.replace("type: noul", "type: noul\npullupCouncilMayPass: false");
    const f = [{ path: ".pullup/rules/no-debug.md", text: strict, from: "default" as const }];
    const fails = [answer("no-debug:0", "yes", 0.9, "console.log(total);")];
    expect(repoRules.detect!(testContext(config, { diff: DIFF, files: f }, fails)).questions![0]!.councilMayPass).toBe(false);
    const loose = [{ path: ".pullup/rules/no-debug.md", text: NO_DEBUG.replace("type: noul", "type: noul\npullupCouncilMayPass: true"), from: "default" as const }];
    expect(repoRules.detect!(testContext({ ...config, councilMayPass: false }, { diff: DIFF, files: loose }, fails)).questions![0]!.councilMayPass).toBe(false);
  });

  it("no rules folder is a note, not a pass of anything", () => {
    expect(repoRules.notes!(testContext(config, { diff: DIFF }))).toEqual([{ text: "No rule files in .pullup/rules on the default branch." }]);
    expect(repoRules.screens!(testContext(config, { diff: DIFF }))).toEqual([]);
  });
});
