import type { CheckRunCall, GitHubApi, JobInfo, WorkflowRunInfo } from "./api";

/** An in-memory GitHub for tests: set the repository's state, then read what PullUp sent. */
export class FakeGitHub implements GitHubApi {
  /** `.pullup/config.json` per repository on its default branch. */
  config = new Map<string, string>();
  runs: (WorkflowRunInfo & { repo: string; headSha: string })[] = [];
  /** Jobs per workflow run id and attempt (`${runId}/${attempt}`). */
  jobsByAttempt = new Map<string, JobInfo[]>();
  logs = new Map<number, string>();
  diffs = new Map<string, string>();
  checkRuns: (CheckRunCall & { id: number })[] = [];
  /** Every call, by name, in order. */
  calls: string[] = [];
  failWrites = false;

  async defaultBranchConfig(repo: string) {
    this.calls.push("defaultBranchConfig");
    return this.config.get(repo) ?? null;
  }
  async workflowRuns(repo: string, headSha: string) {
    this.calls.push("workflowRuns");
    return this.runs.filter((r) => r.repo === repo && r.headSha === headSha);
  }
  async jobs(_repo: string, runId: number, attempt: number) {
    this.calls.push("jobs");
    return this.jobsByAttempt.get(`${runId}/${attempt}`) ?? [];
  }
  async jobLog(_repo: string, jobId: number) {
    this.calls.push("jobLog");
    return this.logs.get(jobId) ?? "";
  }
  async pullDiff(repo: string, pull: number) {
    this.calls.push("pullDiff");
    return this.diffs.get(`${repo}#${pull}`) ?? "";
  }
  async findCheckRun(repo: string, headSha: string, name: string) {
    this.calls.push("findCheckRun");
    return [...this.checkRuns].reverse().find((c) => c.repo === repo && c.headSha === headSha && c.name === name)?.id ?? null;
  }
  async createCheckRun(call: CheckRunCall) {
    this.calls.push("createCheckRun");
    if (this.failWrites) throw new Error("Resource not accessible by integration");
    const id = this.checkRuns.length + 1;
    this.checkRuns.push({ ...call, id });
    return id;
  }
  async updateCheckRun(id: number, call: CheckRunCall) {
    this.calls.push("updateCheckRun");
    if (this.failWrites) throw new Error("Resource not accessible by integration");
    const i = this.checkRuns.findIndex((c) => c.id === id);
    this.checkRuns[i] = { ...call, id };
    return id;
  }
}
