import { attemptPassed, type DiffFile, defineExtension, type Evidence, matchesAny, type QuestionDraft, type RunContext, SENSITIVE_CATEGORIES, type SensitiveCategory, SNAPSHOT_GLOBS, TEST_GLOBS } from "@pullup/sdk";
import { z } from "zod";

/**
 * PullUp's three built-in triggers: a flaky test, weakened tests and a change
 * to a sensitive path. Code decides what is tricky, never the council: each
 * trigger looks at the collected run and raises at most one question with its
 * evidence. Moved here unchanged from the engine's `triggers.ts`.
 */

export const TRIGGER_IDS = ["flaky-test", "weakened-tests", "sensitive-path"] as const;
export type TriggerId = (typeof TRIGGER_IDS)[number];

/** Whether the council may pass each trigger's question on its own, by default. */
export const COUNCIL_MAY_PASS_DEFAULT: Record<TriggerId, boolean> = {
  "flaky-test": true,
  "weakened-tests": true,
  "sensitive-path": false,
};

const trigger = (id: TriggerId) => {
  const defaults = { enabled: true, councilMayPass: COUNCIL_MAY_PASS_DEFAULT[id] };
  return z.object({ enabled: z.boolean().default(true), councilMayPass: z.boolean().default(defaults.councilMayPass) }).default(defaults);
};

const sensitiveCategoryIds = Object.keys(SENSITIVE_CATEGORIES) as [SensitiveCategory, ...SensitiveCategory[]];

const schema = z.object({
  /** Per trigger: switch it off, or change whether the council may pass it alone. */
  triggers: z
    .object({ "flaky-test": trigger("flaky-test"), "weakened-tests": trigger("weakened-tests"), "sensitive-path": trigger("sensitive-path") })
    .strict()
    .default({
      "flaky-test": { enabled: true, councilMayPass: true },
      "weakened-tests": { enabled: true, councilMayPass: true },
      "sensitive-path": { enabled: true, councilMayPass: false },
    }),
  sensitivePaths: z
    .object({
      /** Categories to leave out (all are on by default). */
      off: z.array(z.enum(sensitiveCategoryIds)).default([]),
      /** More globs that count as sensitive. */
      extraGlobs: z.array(z.string().min(1)).default([]),
    })
    .strict()
    .default({ off: [], extraGlobs: [] }),
});
export type CoreConfig = z.infer<typeof schema>;

type Detector = (ctx: RunContext<CoreConfig>) => Omit<QuestionDraft, "key" | "councilMayPass"> | null;

const MAX_EVIDENCE = 12;

const flakyTest: Detector = ({ run, shared }) => {
  const required = new Set(shared.requiredWorkflows);
  const known = new Set(shared.knownFlakyTests);
  const evidence: Evidence[] = [];
  const tests = new Set<string>();
  let flakyJobs = 0;
  for (const job of run.jobs) {
    if (!required.has(job.workflow)) continue;
    const last = job.attempts[job.attempts.length - 1]!;
    // Failed then passed on a rerun, or failed only on known-flaky tests (the hard-failure rule let it through).
    const flaky = attemptPassed(last)
      ? job.attempts.slice(0, -1).filter((a) => !attemptPassed(a))
      : job.attempts.length === 1 && last.failedTests.length > 0 && last.failedTests.every((t) => known.has(t))
        ? [last]
        : [];
    if (flaky.length) flakyJobs++;
    for (const attempt of flaky) {
      attempt.failedTests.forEach((t) => tests.add(t));
      if (attempt.logExcerpt) evidence.push({ source: "log", where: `${job.workflow} / ${job.name}`, line: null, text: attempt.logExcerpt });
    }
  }
  if (!flakyJobs) return null;
  const names = [...tests];
  return {
    prompt: "A test failed and then passed on a rerun, or is known to be flaky. Should this run pass?",
    summary: names.length ? `Flaky: ${names.join(", ")}${names.some((n) => known.has(n)) ? " (on the known-flaky list)" : ""}.` : "A job failed and then passed on a rerun.",
    evidence: evidence.slice(0, MAX_EVIDENCE),
  };
};

const SKIP_ADDED = /\b(?:it|test|describe)\.(?:skip|only|todo)\(|\bx(?:it|describe)\(|@(?:Ignore|Disabled)\b|pytest\.mark\.skip|\bt\.Skip\(/;
const ASSERTION = /\b(?:expect|assert\w*)\s*\(|\bassert\s|\.should\b|\bt\.(?:Error|Fatal)/;

const weakenedTests: Detector = ({ diff: files }) => {
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

const sensitivePath: Detector = ({ diff: files, config }) => {
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

const TRIGGER_LABEL: Record<TriggerId, string> = { "flaky-test": "Flaky test", "weakened-tests": "Weakened tests", "sensitive-path": "Sensitive path" };

export default defineExtension({
  id: "core",
  version: "1.0.0",
  title: "Core checks",
  summary: "Asks about a test that passed only on a rerun, tests that were weakened, and changes to code that is hard to undo.",
  defaultMode: "active",
  config: {
    schema,
    fields: [
      ...TRIGGER_IDS.flatMap((id) => [
        { key: `triggers.${id}.enabled`, label: `${TRIGGER_LABEL[id]}: on`, help: `Raise a question when the ${TRIGGER_LABEL[id].toLowerCase()} check fires.`, kind: "boolean" as const, loosens: true },
        {
          key: `triggers.${id}.councilMayPass`,
          label: `${TRIGGER_LABEL[id]}: the council may pass it alone`,
          help: COUNCIL_MAY_PASS_DEFAULT[id] ? "On by default." : "Off by default: a person decides.",
          kind: "boolean" as const,
          loosens: !COUNCIL_MAY_PASS_DEFAULT[id],
        },
      ]),
      { key: "sensitivePaths.off", label: "Sensitive path categories switched off", help: "Changes to these no longer count as sensitive.", kind: "list", options: sensitiveCategoryIds, loosens: true },
      { key: "sensitivePaths.extraGlobs", label: "More sensitive paths", help: "Globs (for example `src/billing/**`) that also count as sensitive.", kind: "list", loosens: false },
    ],
  },
  loosenings(config) {
    const out: string[] = [];
    for (const id of TRIGGER_IDS) {
      const t = config.triggers[id];
      if (!t.enabled) out.push(`The ${id} trigger is switched off.`);
      else if (t.councilMayPass && !COUNCIL_MAY_PASS_DEFAULT[id]) out.push(`The council may pass ${id} questions without a person.`);
    }
    if (config.sensitivePaths.off.length) out.push(`Sensitive path categories switched off: ${config.sensitivePaths.off.join(", ")}.`);
    return out;
  },
  detect(ctx) {
    const questions: QuestionDraft[] = [];
    for (const id of TRIGGER_IDS) {
      const t = ctx.config.triggers[id];
      if (!t.enabled) continue;
      const draft = DETECTORS[id](ctx);
      if (draft) questions.push({ key: id, councilMayPass: t.councilMayPass, ...draft });
    }
    return { questions };
  },
});
