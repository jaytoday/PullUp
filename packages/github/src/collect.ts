import { type Attempt, type CiRun, type Conclusion, type Config, fileRequests, type Job, type ReadFile } from "@pullup/engine";
import { type GitHubApi, type JobInfo, REPORTS_ARTIFACT, type WorkflowRunInfo } from "./api";
import { junitFailures } from "./junit";

/**
 * Collect one commit's CI results once every required workflow has finished:
 * each job's attempts (a rerun is a later attempt), the end of each failed
 * attempt's log, the pull request's diff, title, body and labels, and the
 * files the enabled extensions asked to read. `force` collects what is there
 * after the wait ran out; a required workflow that never ran is then simply
 * absent, which the hard-failure rule fails ("nothing checked is not a pass").
 */

export type Collected =
  | {
      state: "ready";
      run: CiRun;
      notes: string[];
      /** Required workflow runs on their first attempt with a failed job: what a rerun would cover. */
      rerunnable: number[];
    }
  | { state: "waiting"; pending: string[] };

function toConclusion(c: string | null): Conclusion {
  if (c === "success" || c === "neutral") return "success";
  if (c === "skipped" || c === "cancelled" || c === "timed_out") return c;
  return "failure";
}

const latest = (runs: WorkflowRunInfo[]) => [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

export async function collectRun(api: GitHubApi, input: { repo: string; headSha: string; pull: number | null; config: Config; force?: boolean }): Promise<Collected> {
  const { repo, headSha, pull, config } = input;
  const runs = await api.workflowRuns(repo, headSha);
  const chosen = config.requiredWorkflows.map((name) => ({ name, run: latest(runs.filter((r) => r.name === name)) }));
  const pending = chosen.filter((c) => !c.run || c.run.status !== "completed").map((c) => c.name);
  if (pending.length && !input.force) return { state: "waiting", pending };

  const notes = pending.length ? [`Not finished when PullUp decided: ${pending.join(", ")}.`] : [];
  const jobs: Job[] = [];
  const rerunnable: number[] = [];
  let readReports = false;
  for (const { name, run } of chosen) {
    if (!run || run.status !== "completed") continue;
    const before = jobs.length;
    // Failing test names from the newest JUnit reports; they belong to the jobs that failed in the latest attempt.
    const reports = await api.reports(repo, run.id).catch(() => null);
    if (reports) readReports = true;
    const reportFailures = reports ? [...reports].filter(([file]) => file.endsWith(".xml")).flatMap(([, xml]) => junitFailures(xml)) : [];
    const byName = new Map<string, { info: JobInfo; attempt: number }[]>();
    const seen = new Set<number>();
    for (let attempt = 1; attempt <= run.runAttempt; attempt++) {
      for (const info of await api.jobs(repo, run.id, attempt)) {
        // A rerun of only the failed jobs carries the passed ones over; count each job run once.
        if (seen.has(info.id)) continue;
        seen.add(info.id);
        byName.set(info.name, [...(byName.get(info.name) ?? []), { info, attempt }]);
      }
    }
    for (const [jobName, list] of byName) {
      const attempts: Attempt[] = [];
      for (const { info, attempt } of list.sort((a, b) => a.attempt - b.attempt)) {
        const conclusion = toConclusion(info.conclusion);
        const failed = conclusion !== "success" && conclusion !== "skipped";
        const failedTests = failed && attempt === run.runAttempt ? reportFailures : [];
        attempts.push({ conclusion, failedTests, logExcerpt: failed ? await api.jobLog(repo, info.id) : "" });
      }
      jobs.push({ workflow: name, name: jobName, attempts });
    }
    const failed = jobs.slice(before).some((j) => !["success", "skipped"].includes(j.attempts[j.attempts.length - 1]!.conclusion));
    if (failed && run.runAttempt === 1) rerunnable.push(run.id);
  }
  if (pull === null) notes.push("No pull request for this commit, so there is no diff to check.");
  if (!readReports) notes.push(`No ${REPORTS_ARTIFACT} artifact with JUnit reports: failing test names are unknown, so a failure that was not rerun counts as hard and the known-flaky list cannot match.`);
  const diff = pull === null ? "" : await api.pullDiff(repo, pull);
  const pullInfo = pull === null ? null : await api.pullInfo(repo, pull).catch(() => null);
  if (pull !== null && !pullInfo) notes.push("Could not read the pull request's title, body and labels; extensions that use them saw none.");
  const files = await readExtensionFiles(api, repo, headSha, config, notes);
  return { state: "ready", run: { repo, headSha, jobs, diff, pull: pullInfo, files }, notes, rerunnable };
}

/** Every file the enabled extensions asked for, one read per side (default branch, head commit). A failed read is a note: the files are "no data". */
async function readExtensionFiles(api: GitHubApi, repo: string, headSha: string, config: Config, notes: string[]): Promise<ReadFile[]> {
  const requests = fileRequests(config);
  const files: ReadFile[] = [];
  for (const from of ["default", "head"] as const) {
    const globs = [...new Set(requests.filter((r) => r.from === from).flatMap((r) => r.globs))];
    if (!globs.length) continue;
    try {
      const read = await api.readFiles(repo, from === "default" ? { defaultBranch: true } : { sha: headSha }, globs);
      files.push(...read.map((f) => ({ ...f, from })));
    } catch (err) {
      notes.push(`Could not read the files extensions asked for on the ${from === "default" ? "default branch" : "head commit"} (${(err as Error).message}); those checks had no data.`);
    }
  }
  return files;
}
