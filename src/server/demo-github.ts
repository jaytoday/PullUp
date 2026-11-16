import type { CiRun } from "@pullup/engine";
import type { FakeGitHub } from "@pullup/github";

/**
 * Loads one pull request and its CI results into the fake GitHub client, the
 * way GitHub would report them: one workflow run per workflow, a rerun as a
 * later attempt (jobs that passed are carried over with the same id), the
 * end of each failed attempt's log, the diff and the pull request's details.
 * Used by `pnpm demo` and the tests, so synthetic pull requests go through
 * the real collection code.
 */

let nextId = 1;

export function loadGitHub(gh: FakeGitHub, run: CiRun & { pull?: CiRun["pull"] }) {
  const pull = run.pull ?? null;
  const workflows = [...new Set(run.jobs.map((j) => j.workflow))];
  for (const workflow of workflows) {
    const jobs = run.jobs.filter((j) => j.workflow === workflow);
    const attempts = Math.max(...jobs.map((j) => j.attempts.length));
    const runId = nextId++;
    const last = jobs.map((j) => j.attempts[j.attempts.length - 1]!.conclusion);
    gh.runs.push({ repo: run.repo, headSha: run.headSha, id: runId, name: workflow, status: "completed", conclusion: last.every((c) => c === "success" || c === "skipped") ? "success" : "failure", runAttempt: attempts, createdAt: new Date().toISOString() });
    const ids = new Map(jobs.map((j) => [j.name, nextId++]));
    for (let k = 1; k <= attempts; k++) {
      const list = jobs.flatMap((j) => {
        // A job with fewer attempts than the run passed earlier and is carried over unchanged.
        const a = j.attempts[Math.min(k, j.attempts.length) - 1]!;
        const id = k <= j.attempts.length ? (k === 1 ? ids.get(j.name)! : nextId++) : ids.get(j.name)!;
        if (a.logExcerpt) gh.logs.set(id, a.logExcerpt);
        return [{ id, name: j.name, conclusion: a.conclusion }];
      });
      gh.jobsByAttempt.set(`${runId}/${k}`, list);
    }
    // Every synthetic workflow uploads its test report, as a well-set-up repository does.
    const failed = jobs.flatMap((j) => j.attempts[j.attempts.length - 1]!.failedTests ?? []);
    gh.reportFiles.set(runId, new Map([["junit.xml", junit(failed)]]));
  }
  if (pull) {
    gh.diffs.set(`${run.repo}#${pull.number}`, run.diff ?? "");
    gh.pulls.set(`${run.repo}#${pull.number}`, { number: pull.number, title: pull.title ?? "", body: pull.body ?? "", labels: pull.labels ?? [], author: pull.author ?? "" });
  }
}

/** A minimal JUnit report naming the failing tests ("file > name"). */
function junit(tests: string[]): string {
  const cases = tests.map((t) => {
    const [file, name] = t.split(" > ");
    return `<testcase classname="${file}" name="${name ?? file}"><failure message="failed">failed</failure></testcase>`;
  });
  return `<?xml version="1.0"?><testsuites><testsuite name="ci">${cases.join("")}</testsuite></testsuites>`;
}
