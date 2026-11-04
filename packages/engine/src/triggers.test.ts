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
  const config = parseConfig({ requiredWorkflows: ["ci"] });
  const run = (diff: string) => ciRunSchema.parse({ repo: "a/b", headSha: "x", jobs: [{ workflow: "ci", name: "t", attempts: [{ conclusion: "success" }] }], diff });

  it("a sensitive path is never council-passable by default, but the repo may change that", () => {
    const diff = "--- a/db/migrations/1.sql\n+++ b/db/migrations/1.sql\n@@ -1 +1 @@\n-a\n+b\n";
    expect(findQuestions(run(diff), config)[0]).toMatchObject({ trigger: "sensitive-path", councilMayPass: false });
    const loosened = parseConfig({ requiredWorkflows: ["ci"], triggers: { "sensitive-path": { councilMayPass: true } } });
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
});
