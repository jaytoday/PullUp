import { type Config, councilMayPass, type TriggerId, triggerEnabled } from "./config";
import { attemptPassed, type ParsedCiRun } from "./ci";
import { type DiffFile, parseDiff } from "./diff";
import { matchesAny, SENSITIVE_CATEGORIES, SNAPSHOT_GLOBS, type SensitiveCategory, TEST_GLOBS } from "./paths";
import type { Evidence, Question } from "./question";

/**
 * Code decides what is tricky, never the council. Each trigger looks at the
 * collected run and returns at most one question with its evidence, or null.
 * No trigger fired → the run passes with no WithAI call.
 */

type Draft = Omit<Question, "id" | "trigger" | "councilMayPass">;
type Detector = (run: ParsedCiRun, files: DiffFile[], config: Config) => Draft | null;

const MAX_EVIDENCE = 12;

const flakyTest: Detector = (run, _files, config) => {
  const required = new Set(config.requiredWorkflows);
  const known = new Set(config.flaky.knownTests);
  const evidence: Evidence[] = [];
  const tests = new Set<string>();
  for (const job of run.jobs) {
    if (!required.has(job.workflow)) continue;
    const last = job.attempts[job.attempts.length - 1]!;
    // Failed then passed on a rerun, or failed only on known-flaky tests (the hard-failure rule let it through).
    const flaky = attemptPassed(last)
      ? job.attempts.slice(0, -1).filter((a) => !attemptPassed(a))
      : job.attempts.length === 1 && last.failedTests.length > 0 && last.failedTests.every((t) => known.has(t))
        ? [last]
        : [];
    for (const attempt of flaky) {
      attempt.failedTests.forEach((t) => tests.add(t));
      if (attempt.logExcerpt) evidence.push({ source: "log", where: `${job.workflow} / ${job.name}`, line: null, text: attempt.logExcerpt });
    }
  }
  if (!tests.size && !evidence.length) return null;
  const names = [...tests];
  return {
    prompt: "A test failed and then passed on a rerun, or is known to be flaky. Should this run pass?",
    summary: names.length ? `Flaky: ${names.join(", ")}${names.some((n) => known.has(n)) ? " (on the known-flaky list)" : ""}.` : "A job failed and then passed on a rerun.",
    evidence: evidence.slice(0, MAX_EVIDENCE),
  };
};

const SKIP_ADDED = /\b(?:it|test|describe)\.(?:skip|only|todo)\(|\bx(?:it|describe)\(|@(?:Ignore|Disabled)\b|pytest\.mark\.skip|\bt\.Skip\(/;
const ASSERTION = /\b(?:expect|assert\w*)\s*\(|\bassert\s|\.should\b|\bt\.(?:Error|Fatal)/;

const weakenedTests: Detector = (_run, files) => {
  const evidence: Evidence[] = [];
  const reasons = new Set<string>();
  const changesCode = files.some((f) => !matchesAny(f.path, TEST_GLOBS) && !matchesAny(f.path, SNAPSHOT_GLOBS));
  for (const f of files) {
    if (matchesAny(f.path, SNAPSHOT_GLOBS)) {
      if (changesCode && f.status !== "added") {
        reasons.add("snapshots rewritten in the same change as code");
        const line = f.lines.find((l) => l.kind !== "context");
        if (line) evidence.push({ source: "diff", where: f.path, line: line.newLine ?? line.oldLine, text: line.text });
      }
      continue;
    }
    if (!matchesAny(f.path, TEST_GLOBS)) continue;
    if (f.status === "deleted") {
      reasons.add("test file deleted");
      const line = f.lines.find((l) => l.kind === "remove" && l.text.trim());
      evidence.push({ source: "diff", where: f.path, line: line?.oldLine ?? null, text: line?.text ?? "" });
      continue;
    }
    for (const l of f.lines) {
      if (l.kind === "add" && SKIP_ADDED.test(l.text)) {
        reasons.add("skip or only added");
        evidence.push({ source: "diff", where: f.path, line: l.newLine, text: l.text });
      }
    }
    const removed = f.lines.filter((l) => l.kind === "remove" && ASSERTION.test(l.text));
    const added = f.lines.filter((l) => l.kind === "add" && ASSERTION.test(l.text)).length;
    if (removed.length > added) {
      reasons.add("assertions removed");
      for (const l of removed) evidence.push({ source: "diff", where: f.path, line: l.oldLine, text: l.text });
    }
  }
  if (!reasons.size) return null;
  return {
    prompt: "Tests were weakened in this change. Is that justified by what the change does, so the run should pass?",
    summary: `Weakened tests: ${[...reasons].join("; ")}.`,
    evidence: evidence.slice(0, MAX_EVIDENCE),
  };
};

const sensitivePath: Detector = (_run, files, config) => {
  const off = new Set<SensitiveCategory>(config.sensitivePaths.off);
  const groups = Object.entries(SENSITIVE_CATEGORIES)
    .filter(([id]) => !off.has(id as SensitiveCategory))
    .map(([, c]): { label: string; globs: string[] } => ({ label: c.label, globs: [...c.globs] }));
  if (config.sensitivePaths.extraGlobs.length) groups.push({ label: "Repository's sensitive paths", globs: config.sensitivePaths.extraGlobs });
  const hits: { path: string; label: string; file: DiffFile }[] = [];
  for (const f of files) {
    for (const path of new Set([f.path, f.oldPath].filter((p): p is string => !!p))) {
      const group = groups.find((g) => matchesAny(path, g.globs));
      if (group) {
        hits.push({ path, label: group.label, file: f });
        break;
      }
    }
  }
  if (!hits.length) return null;
  const labels = [...new Set(hits.map((h) => h.label))];
  return {
    prompt: "This change touches code that is hard to undo. Is it safe to pass?",
    summary: `${labels.join(", ")}: ${hits.map((h) => h.path).join(", ")}.`,
    evidence: hits
      .map((h) => {
        const line = h.file.lines.find((l) => l.kind !== "context");
        return { source: "diff" as const, where: h.path, line: line ? (line.newLine ?? line.oldLine) : null, text: line?.text ?? "" };
      })
      .slice(0, MAX_EVIDENCE),
  };
};

const DETECTORS: Record<TriggerId, Detector> = {
  "flaky-test": flakyTest,
  "weakened-tests": weakenedTests,
  "sensitive-path": sensitivePath,
};

/** Every question the run raises, in trigger order. Empty means nothing tricky. */
export function findQuestions(run: ParsedCiRun, config: Config): Question[] {
  const files = parseDiff(run.diff);
  const questions: Question[] = [];
  for (const [trigger, detect] of Object.entries(DETECTORS) as [TriggerId, Detector][]) {
    if (!triggerEnabled(config, trigger)) continue;
    const draft = detect(run, files, config);
    if (draft) questions.push({ id: trigger, trigger, councilMayPass: councilMayPass(config, trigger), ...draft });
  }
  return questions;
}
