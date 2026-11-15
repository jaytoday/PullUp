import { attemptPassed, type ParsedCiRun } from "./ci";
import { CONCERNS, type Concern, type Config } from "./config";
import { type DiffFile, parseDiff } from "./diff";
import { matchesAny, SENSITIVE_CATEGORIES, type SensitiveCategory, SNAPSHOT_GLOBS, TEST_GLOBS } from "./paths";

/**
 * The three concerns PullUp may ask its decision runtime about. Plain code
 * detects each one and collects its evidence; the runtime judges it. A
 * detector is a hint for the agent and the input for `assess`, never a
 * verdict. Moved from jaytoday/PullUp@7c7ca87:packages/extensions/src/core/index.ts.
 */

/** One piece of evidence: a line of the diff or the end of a job log, quoted exactly so an answer's citation can be checked against it. */
export interface Evidence {
  source: "diff" | "log";
  /** File (diff), or "workflow / job" (log). */
  where: string;
  line: number | null;
  text: string;
}

export interface ConcernCase {
  concern: Concern;
  /** Plain-language summary of what raised the concern. */
  summary: string;
  evidence: Evidence[];
  /** Changed lines in sensitive paths, capped at `MAX_BLAST_RADIUS`: how much a wrong "safe" could break. */
  blastRadius: number;
}

export const MAX_EVIDENCE = 12;
export const MAX_BLAST_RADIUS = 500;
const MAX_EVIDENCE_CHARS = 1500;

const clip = (e: Evidence): Evidence => ({ ...e, text: e.text.slice(-MAX_EVIDENCE_CHARS) });

/** The sensitive path groups a repository's config turns on. */
export function sensitiveGroups(config: Config): Array<{ label: string; globs: string[] }> {
  const off = new Set<SensitiveCategory>(config.sensitivePaths.off);
  const groups = Object.entries(SENSITIVE_CATEGORIES)
    .filter(([id]) => !off.has(id as SensitiveCategory))
    .map(([, c]): { label: string; globs: string[] } => ({ label: c.label, globs: [...c.globs] }));
  if (config.sensitivePaths.extraGlobs.length) groups.push({ label: "Repository's sensitive paths", globs: config.sensitivePaths.extraGlobs });
  return groups;
}

function sensitiveFile(f: DiffFile, groups: ReturnType<typeof sensitiveGroups>): { path: string; label: string } | null {
  for (const path of new Set([f.path, f.oldPath].filter((p): p is string => !!p))) {
    const g = groups.find((x) => matchesAny(path, x.globs));
    if (g) return { path, label: g.label };
  }
  return null;
}

export function blastRadius(files: DiffFile[], config: Config): number {
  const groups = sensitiveGroups(config);
  const n = files.filter((f) => sensitiveFile(f, groups)).reduce((sum, f) => sum + f.lines.filter((l) => l.kind !== "context").length, 0);
  return Math.min(n, MAX_BLAST_RADIUS);
}

type Detector = (run: ParsedCiRun, files: DiffFile[], config: Config) => Omit<ConcernCase, "concern" | "blastRadius"> | null;

const flakyRetry: Detector = (run, _files, config) => {
  const required = new Set(config.requiredWorkflows);
  const known = new Set(config.flaky.knownTests);
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
    summary: names.length ? `Flaky: ${names.join(", ")}${names.some((n) => known.has(n)) ? " (on the known-flaky list)" : ""}.` : "A job failed and then passed on a rerun.",
    evidence,
  };
};

const SKIP_ADDED = /\b(?:it|test|describe)\.(?:skip|only|todo)\(|\bx(?:it|describe)\(|@(?:Ignore|Disabled)\b|pytest\.mark\.skip|\bt\.Skip\(/;
const ASSERTION = /\b(?:expect|assert\w*)\s*\(|\bassert\s|\.should\b|\bt\.(?:Error|Fatal)/;

const deletedTests: Detector = (_run, files) => {
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
  return { summary: `Tests weakened: ${[...reasons].join("; ")}.`, evidence };
};

const sensitiveChange: Detector = (_run, files, config) => {
  const groups = sensitiveGroups(config);
  const hits = files.flatMap((f) => {
    const s = sensitiveFile(f, groups);
    return s ? [{ ...s, file: f }] : [];
  });
  if (!hits.length) return null;
  const labels = [...new Set(hits.map((h) => h.label))];
  return {
    summary: `${labels.join(", ")}: ${hits.map((h) => h.path).join(", ")}.`,
    evidence: hits.flatMap((h) =>
      h.file.lines
        .filter((l) => l.kind !== "context" && l.text.trim())
        .slice(0, 4)
        .map((l) => ({ source: "diff" as const, where: h.path, line: l.newLine ?? l.oldLine, text: l.text })),
    ),
  };
};

const DETECTORS: Record<Concern, Detector> = { flaky_retry: flakyRetry, deleted_tests: deletedTests, sensitive_change: sensitiveChange };

/** Every enabled concern that fires on this run, with its evidence and the blast radius. */
export function detectConcerns(run: ParsedCiRun, config: Config): ConcernCase[] {
  const files = parseDiff(run.diff);
  const radius = blastRadius(files, config);
  return CONCERNS.flatMap((concern) => {
    if (!config.concerns[concern]) return [];
    const found = DETECTORS[concern](run, files, config);
    return found ? [{ concern, summary: found.summary, evidence: found.evidence.slice(0, MAX_EVIDENCE).map(clip), blastRadius: radius }] : [];
  });
}
