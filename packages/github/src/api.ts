import type { Octokit } from "@octokit/rest";
import { matchesAny, type PullInfo } from "@pullup/engine";
import { strFromU8, unzipSync } from "fflate";

/**
 * The GitHub calls PullUp makes, kept narrow so tests can use a fake. Reads
 * (collection) and the one write (the check run, sent only by the governed
 * sender). PullUp never merges, changes branch protection or reverts.
 */

export interface WorkflowRunInfo {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  runAttempt: number;
  createdAt: string;
}

export interface JobInfo {
  id: number;
  name: string;
  conclusion: string | null;
}

export interface CheckRunCall {
  repo: string;
  headSha: string;
  name: string;
  status: "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | null;
  title: string;
  summary: string;
  /** Link back to the run in PullUp's dashboard. */
  detailsUrl?: string;
  /** Buttons on the check run (GitHub "requested actions"); pressing one sends a `check_run` webhook. */
  actions?: { label: string; identifier: string; description: string }[];
  /** File and line findings, at most 50 (GitHub's limit per call). */
  annotations?: { path: string; line: number; level: "notice" | "warning" | "failure"; message: string }[];
}

export interface RerunCall {
  repo: string;
  workflowRunId: number;
}

export interface CommentCall {
  repo: string;
  issue: number;
  body: string;
}

export interface GitHubApi {
  /** `.pullup/config.json` on the repository's default branch, or null when there is none. */
  defaultBranchConfig(repo: string): Promise<string | null>;
  workflowRuns(repo: string, headSha: string): Promise<WorkflowRunInfo[]>;
  jobs(repo: string, runId: number, attempt: number): Promise<JobInfo[]>;
  /** The end of a job's log. */
  jobLog(repo: string, jobId: number): Promise<string>;
  pullDiff(repo: string, pull: number): Promise<string>;
  findCheckRun(repo: string, headSha: string, name: string): Promise<number | null>;
  createCheckRun(call: CheckRunCall): Promise<number>;
  updateCheckRun(id: number, call: CheckRunCall): Promise<number>;
  createComment(call: CommentCall): Promise<number>;
  /** The files in a workflow run's newest `pullup-reports` artifact (name → text), or null when there is none. */
  reports(repo: string, workflowRunId: number): Promise<Map<string, string> | null>;
  /** Rerun the failed jobs of one workflow run (needs Actions write). */
  rerunFailedJobs(call: RerunCall): Promise<number>;
  /** "admin", "write", "read" or "none". */
  permission(repo: string, login: string): Promise<string>;
  /** The pull request's title, body, labels and author. */
  pullInfo(repo: string, pull: number): Promise<PullInfo>;
  /**
   * Text files matching any of `globs` at `ref` (the default branch, or a commit),
   * at most `READ_LIMITS.files` files of `READ_LIMITS.fileBytes` each. Larger or
   * binary files are left out (the agent sees "no data").
   */
  readFiles(repo: string, ref: { defaultBranch: true } | { sha: string }, globs: string[]): Promise<{ path: string; text: string }[]>;
}

export const READ_LIMITS = { files: 40, fileBytes: 200_000 };

const split = (repo: string) => {
  const [owner, name] = repo.split("/") as [string, string];
  return { owner, repo: name };
};

/** The workflow artifact that holds test reports (JUnit XML). */
export const REPORTS_ARTIFACT = "pullup-reports";

const LOG_TAIL_LINES = 60;
const LOG_TAIL_CHARS = 4000;

/** The end of a log, with GitHub's timestamps taken off each line. */
export function logTail(log: string): string {
  const lines = log.replace(/\r/g, "").split("\n").map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, ""));
  return lines.slice(-LOG_TAIL_LINES).join("\n").trim().slice(-LOG_TAIL_CHARS);
}

export function octokitApi(octokit: (repo: string) => Promise<Octokit>): GitHubApi {
  const checkBody = (c: CheckRunCall) => ({
    ...split(c.repo),
    name: c.name,
    head_sha: c.headSha,
    status: c.status,
    ...(c.conclusion ? { conclusion: c.conclusion } : {}),
    ...(c.detailsUrl ? { details_url: c.detailsUrl } : {}),
    output: {
      title: c.title,
      summary: c.summary,
      ...(c.annotations?.length ? { annotations: c.annotations.slice(0, 50).map((a) => ({ path: a.path, start_line: a.line, end_line: a.line, annotation_level: a.level, message: a.message })) } : {}),
    },
    actions: c.actions ?? [],
  });
  return {
    async defaultBranchConfig(repo) {
      const gh = await octokit(repo);
      const { data } = await gh.rest.repos.get(split(repo));
      try {
        const res = await gh.rest.repos.getContent({ ...split(repo), path: ".pullup/config.json", ref: data.default_branch });
        const file = res.data as { content?: string };
        return file.content ? Buffer.from(file.content, "base64").toString("utf8") : null;
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    async workflowRuns(repo, headSha) {
      const gh = await octokit(repo);
      const runs = await gh.paginate(gh.rest.actions.listWorkflowRunsForRepo, { ...split(repo), head_sha: headSha, per_page: 100 });
      return runs.map((r) => ({ id: r.id, name: r.name ?? "", status: r.status ?? "", conclusion: r.conclusion ?? null, runAttempt: r.run_attempt ?? 1, createdAt: r.created_at }));
    },
    async jobs(repo, runId, attempt) {
      const gh = await octokit(repo);
      const jobs = await gh.paginate(gh.rest.actions.listJobsForWorkflowRunAttempt, { ...split(repo), run_id: runId, attempt_number: attempt, per_page: 100 });
      return jobs.map((j) => ({ id: j.id, name: j.name, conclusion: j.conclusion ?? null }));
    },
    async jobLog(repo, jobId) {
      const gh = await octokit(repo);
      try {
        const { data } = await gh.rest.actions.downloadJobLogsForWorkflowRun({ ...split(repo), job_id: jobId });
        return logTail(String(data));
      } catch {
        return "";
      }
    },
    async pullDiff(repo, pull) {
      const gh = await octokit(repo);
      const { data } = await gh.rest.pulls.get({ ...split(repo), pull_number: pull, mediaType: { format: "diff" } });
      return String(data);
    },
    async findCheckRun(repo, headSha, name) {
      const gh = await octokit(repo);
      const { data } = await gh.rest.checks.listForRef({ ...split(repo), ref: headSha, check_name: name, filter: "latest" });
      return data.check_runs[0]?.id ?? null;
    },
    async createCheckRun(call) {
      const gh = await octokit(call.repo);
      return (await gh.rest.checks.create(checkBody(call))).data.id;
    },
    async updateCheckRun(id, call) {
      const gh = await octokit(call.repo);
      const { head_sha: _sha, ...body } = checkBody(call);
      return (await gh.rest.checks.update({ ...body, check_run_id: id })).data.id;
    },
    async createComment(call) {
      const gh = await octokit(call.repo);
      return (await gh.rest.issues.createComment({ ...split(call.repo), issue_number: call.issue, body: call.body })).data.id;
    },
    async reports(repo, workflowRunId) {
      const gh = await octokit(repo);
      const { data } = await gh.rest.actions.listWorkflowRunArtifacts({ ...split(repo), run_id: workflowRunId, name: REPORTS_ARTIFACT });
      const newest = data.artifacts.filter((a) => !a.expired).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
      if (!newest) return null;
      const zip = await gh.rest.actions.downloadArtifact({ ...split(repo), artifact_id: newest.id, archive_format: "zip" });
      const files = unzipSync(new Uint8Array(zip.data as ArrayBuffer));
      return new Map(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
    },
    async rerunFailedJobs(call) {
      const gh = await octokit(call.repo);
      await gh.rest.actions.reRunWorkflowFailedJobs({ ...split(call.repo), run_id: call.workflowRunId });
      return call.workflowRunId;
    },
    async pullInfo(repo, pull) {
      const gh = await octokit(repo);
      const { data } = await gh.rest.pulls.get({ ...split(repo), pull_number: pull });
      return { number: pull, title: data.title, body: data.body ?? "", labels: data.labels.map((l) => l.name ?? "").filter(Boolean), author: data.user?.login ?? "" };
    },
    async readFiles(repo, ref, globs) {
      const gh = await octokit(repo);
      const sha = "sha" in ref ? ref.sha : (await gh.rest.repos.get(split(repo))).data.default_branch;
      const { data: tree } = await gh.rest.git.getTree({ ...split(repo), tree_sha: sha, recursive: "true" });
      const wanted = tree.tree.filter((e) => e.type === "blob" && e.path && (e.size ?? 0) <= READ_LIMITS.fileBytes && matchesAny(e.path, globs)).slice(0, READ_LIMITS.files);
      const out: { path: string; text: string }[] = [];
      for (const entry of wanted) {
        const { data } = await gh.rest.git.getBlob({ ...split(repo), file_sha: entry.sha! });
        const text = Buffer.from(data.content, "base64").toString("utf8");
        if (!text.includes("\u0000")) out.push({ path: entry.path!, text });
      }
      return out;
    },
    async permission(repo, login) {
      const gh = await octokit(repo);
      try {
        return (await gh.rest.repos.getCollaboratorPermissionLevel({ ...split(repo), username: login })).data.permission;
      } catch {
        return "none";
      }
    },
  };
}
