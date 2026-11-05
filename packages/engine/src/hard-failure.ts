import type { Config } from "./config";
import { attemptPassed as passed, type Job, type ParsedCiRun } from "@pullup/sdk";

/**
 * Rule 1 of the flow: a hard failure always fails the run, with no AI call.
 *
 * A required job is a hard failure when its last attempt did not pass and
 * either it was rerun and failed every time, or it was not rerun and at least
 * one failing test is not on the known-flaky list (or no failing test is
 * named, so nothing shows it was flaky). A job that failed and then passed on
 * a rerun is not a hard failure: it is a flaky-test question for later.
 * A required workflow that never ran, or whose jobs were all skipped, is a
 * hard failure too: nothing checked is not a pass.
 */

export interface HardFailure {
  workflow: string;
  job: string | null;
  reason: string;
  logExcerpt: string;
}

function jobFailure(job: Job, knownFlaky: Set<string>): HardFailure | null {
  const last = job.attempts[job.attempts.length - 1]!;
  if (passed(last)) return null;
  const base = { workflow: job.workflow, job: job.name, logExcerpt: last.logExcerpt };
  if (job.attempts.length > 1) {
    if (job.attempts.some(passed)) return null;
    return { ...base, reason: `${job.name} failed on all ${job.attempts.length} attempts (${last.conclusion}).` };
  }
  const unknown = last.failedTests.filter((t) => !knownFlaky.has(t));
  if (last.failedTests.length > 0 && unknown.length === 0) return null;
  const named = unknown.length ? `: ${unknown.slice(0, 5).join(", ")}` : "";
  return { ...base, reason: `${job.name} ${last.conclusion === "failure" ? "failed" : `ended ${last.conclusion}`}${named}.` };
}

export function findHardFailures(run: ParsedCiRun, config: Config): HardFailure[] {
  const knownFlaky = new Set(config.flaky.knownTests);
  const required = new Set(config.requiredWorkflows);
  const failures: HardFailure[] = [];
  for (const workflow of config.requiredWorkflows) {
    const jobs = run.jobs.filter((j) => j.workflow === workflow);
    if (!jobs.length) {
      failures.push({ workflow, job: null, reason: `Required workflow "${workflow}" did not run.`, logExcerpt: "" });
    } else if (jobs.every((j) => j.attempts[j.attempts.length - 1]!.conclusion === "skipped")) {
      failures.push({ workflow, job: null, reason: `Every job of required workflow "${workflow}" was skipped.`, logExcerpt: "" });
    }
  }
  for (const job of run.jobs) {
    if (!required.has(job.workflow)) continue;
    const failure = jobFailure(job, knownFlaky);
    if (failure) failures.push(failure);
  }
  return failures;
}
