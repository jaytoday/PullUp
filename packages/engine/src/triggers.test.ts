import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ciRunSchema } from "./ci";
import { parseConfig } from "./config";
import { parseDiff } from "./diff";
import { loadFixtures } from "./fixtures";
import { findQuestions } from "./triggers";

const fixtures = loadFixtures(fileURLToPath(new URL("../../../fixtures", import.meta.url)));

describe("triggers over every fixture", () => {
  for (const f of fixtures) {
    it(`${f.name}: ${f.description}`, () => {
      const questions = findQuestions(f.run, f.config);
      expect(questions.map((q) => q.trigger)).toEqual(f.expect.triggers);
    });
  }

  it("every diff quote in the evidence appears in the diff, and every log quote in a job log", () => {
    for (const f of fixtures) {
      const logs = f.run.jobs.flatMap((j) => j.attempts.map((a) => a.logExcerpt));
      for (const e of findQuestions(f.run, f.config).flatMap((q) => q.evidence)) {
        if (e.source === "diff") expect(f.run.diff).toContain(e.text);
        if (e.source === "log") expect(logs).toContain(e.text);
      }
    }
  });
});

describe("trigger details", () => {
  it("a job that failed then passed on a rerun is a flaky-test question even with no log or test names", () => {
    const run = ciRunSchema.parse({ repo: "a/b", headSha: "s", jobs: [{ workflow: "ci", name: "test", attempts: [{ conclusion: "failure" }, { conclusion: "success" }] }] });
    const [q] = findQuestions(run, parseConfig({ requiredWorkflows: ["ci"], ask: { to: "x" } }));
    expect(q).toMatchObject({ trigger: "flaky-test", summary: "A job failed and then passed on a rerun.", evidence: [] });
  });

  const config = parseConfig({ requiredWorkflows: ["ci"], ask: { to: "sam" } });
  const run = (diff: string) => ciRunSchema.parse({ repo: "a/b", headSha: "x", jobs: [{ workflow: "ci", name: "t", attempts: [{ conclusion: "success" }] }], diff });

  it("a sensitive path is never council-passable by default, but the repo may change that", () => {
    const diff = "--- a/db/migrations/1.sql\n+++ b/db/migrations/1.sql\n@@ -1 +1 @@\n-a\n+b\n";
    expect(findQuestions(run(diff), config)[0]).toMatchObject({ trigger: "sensitive-path", councilMayPass: false });
    const loosened = parseConfig({ requiredWorkflows: ["ci"], ask: { to: "sam" }, triggers: { "sensitive-path": { councilMayPass: true } } });
    expect(findQuestions(run(diff), loosened)[0]?.councilMayPass).toBe(true);
  });

  it("evidence points at the file and the new line number", () => {
    const diff = "--- a/test/a.test.ts\n+++ b/test/a.test.ts\n@@ -10,2 +10,2 @@\n context\n-it('x', () => {});\n+it.only('x', () => {});\n";
    expect(findQuestions(run(diff), config)[0]?.evidence[0]).toEqual({ source: "diff", where: "test/a.test.ts", line: 11, text: "it.only('x', () => {});" });
  });

  it("an unchanged run with no diff raises nothing", () => {
    expect(findQuestions(run(""), config)).toEqual([]);
  });
});

describe("parseDiff", () => {
  it("reads added, deleted and renamed files with line numbers", () => {
    const files = parseDiff(
      "--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n--- a/from.ts\n+++ b/to.ts\n@@ -5,2 +5,2 @@\n keep\n-y\n+z\n",
    );
    expect(files.map((f) => [f.path, f.oldPath, f.status])).toEqual([
      ["new.ts", null, "added"],
      ["old.ts", "old.ts", "deleted"],
      ["to.ts", "from.ts", "modified"],
    ]);
    expect(files[0]!.lines.map((l) => l.newLine)).toEqual([1, 2]);
    expect(files[2]!.lines).toEqual([
      { kind: "context", text: "keep", newLine: 5, oldLine: 5 },
      { kind: "remove", text: "y", newLine: null, oldLine: 6 },
      { kind: "add", text: "z", newLine: 6, oldLine: null },
    ]);
  });

  it("a removed '-- ' line followed by an added '++ ' line stays inside the hunk", () => {
    const files = parseDiff("--- a/q.sql\n+++ b/q.sql\n@@ -1,2 +1,2 @@\n--- old comment\n+++ new comment\n select 1;\n--- a/r.sql\n+++ b/r.sql\n@@ -1 +1 @@\n-x\n+y\n");
    expect(files.map((f) => f.path)).toEqual(["q.sql", "r.sql"]);
    expect(files[0]!.lines.map((l) => `${l.kind}:${l.text}`)).toEqual(["remove:-- old comment", "add:++ new comment", "context:select 1;"]);
  });
});

describe("loosenings", () => {
  it("the defaults loosen nothing; each looser setting is named", async () => {
    const { loosenings } = await import("./config");
    expect(loosenings(parseConfig({ requiredWorkflows: ["ci"], ask: { to: "a@b.c" } }))).toEqual([]);
    const loose = parseConfig({
      requiredWorkflows: ["ci"],
      triggers: { "sensitive-path": { councilMayPass: true }, "flaky-test": { enabled: false } },
      sensitivePaths: { off: ["payments"] },
      council: { passStrength: 3, needsPersonBlocksPass: false },
      ask: { to: "a@b.c", backup: "c@d.e", onNoAnswer: "escalate", onNoAnswerAfterBackup: "pass", perTrigger: { "weakened-tests": "follow-council" } },
    });
    expect(loosenings(loose)).toHaveLength(7);
  });
});
