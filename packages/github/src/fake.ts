import type { CheckRunCall, CommentCall, GitHubApi, JobInfo, RerunCall, WorkflowRunInfo } from "./api";

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
  comments: (CommentCall & { id: number })[] = [];
  reruns: RerunCall[] = [];
  /** `pullup-reports` files per workflow run id. */
  reportFiles = new Map<number, Map<string, string>>();
  /** Repo permission per login; anyone else has "none". */
  permissions = new Map<string, string>();
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
  /** GitHub's limits on check run buttons ("requested actions"), which it enforces by refusing the call. */
  private checkLimits(call: CheckRunCall) {
    for (const a of call.actions ?? []) {
      if (a.label.length > 20 || a.identifier.length > 20 || a.description.length > 40) throw new Error(`Invalid request: action "${a.label}" is over GitHub's length limits`);
    }
    if ((call.actions?.length ?? 0) > 3) throw new Error("Invalid request: at most 3 actions");
    if (call.title.length > 255 || call.summary.length > 65_535) throw new Error("Invalid request: output too long");
  }
  async createCheckRun(call: CheckRunCall) {
    this.calls.push("createCheckRun");
    if (this.failWrites) throw new Error("Resource not accessible by integration");
    this.checkLimits(call);
    const id = this.checkRuns.length + 1;
    this.checkRuns.push({ ...call, id });
    return id;
  }
  async updateCheckRun(id: number, call: CheckRunCall) {
    this.calls.push("updateCheckRun");
    if (this.failWrites) throw new Error("Resource not accessible by integration");
    this.checkLimits(call);
    const i = this.checkRuns.findIndex((c) => c.id === id);
    this.checkRuns[i] = { ...call, id };
    return id;
  }
  async createComment(call: CommentCall) {
    this.calls.push("createComment");
    if (this.failWrites) throw new Error("Resource not accessible by integration");
    const id = this.comments.length + 1;
    this.comments.push({ ...call, id });
    return id;
  }
  async reports(_repo: string, workflowRunId: number) {
    this.calls.push("reports");
    return this.reportFiles.get(workflowRunId) ?? null;
  }
  async rerunFailedJobs(call: RerunCall) {
    this.calls.push("rerunFailedJobs");
    if (this.failWrites) throw new Error("Resource not accessible by integration");
    this.reruns.push(call);
    return call.workflowRunId;
  }
  async permission(_repo: string, login: string) {
    this.calls.push("permission");
    return this.permissions.get(login) ?? "none";
  }
}
