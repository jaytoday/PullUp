// Live GitHub PullSource via octokit. Authenticates as a GitHub App (or any
// token with repo read + pull/issue read scope). Defect proxies are derived
// from the issue timeline (cross-referenced revert/hotfix PRs). Tagged "live"
// in the eval harness — fixtures remain the offline default.

import type { Octokit } from "@octokit/rest";
import type {
  LintRuleFile,
  PullSource,
  SourceHunk,
  SourceDefectEvent,
  SourcePull,
  SourceRepo,
  SourceReview,
  SourceReviewComment,
} from "@pullup/core";
import { parseFilePatch, parseRepoId } from "@pullup/core";

export interface OctokitSourceOptions {
  readonly repoId: string;
  readonly octokit: Octokit;
  /**
   * Only these PRs (a webhook refresh of an already-ingested repo). Default:
   * every PR in the repo.
   */
  readonly pullNumbers?: readonly number[];
}

/** Bounds on reading a rules folder: subfolder depth and file count. */
const LINT_MAX_DEPTH = 4;
const LINT_MAX_FILES = 60;

const REVERT_RE = /\b(revert|hotfix|rollback)\b/i;
const FOLLOWUP_RE = /\b(follow[- ]?up fix|fix.*regression|reopen)\b/i;

/** Minimal structural types — keeps the live adapter decoupled from octokit's
 * union-heavy endpoint typings. */
interface GHPull {
  number: number;
  title: string;
  user?: { login?: string } | null;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
  state: string;
  base: { ref: string };
  head: { sha: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
  labels: Array<{ name: string }>;
  draft?: boolean;
}

interface GHReview {
  id: number;
  user?: { login?: string } | null;
  submitted_at?: string;
  updated_at?: string;
  state: string;
  body?: string | null;
  commit_id?: string | null;
}

interface GHComment {
  id: number;
  user?: { login?: string } | null;
  created_at: string;
  path?: string | null;
  body: string;
}

export class OctokitPullSource implements PullSource {
  readonly repoId: string;
  private readonly owner: string;
  private readonly repo: string;

  constructor(private readonly opts: OctokitSourceOptions) {
    this.repoId = opts.repoId;
    const parsed = parseRepoId(opts.repoId);
    this.owner = parsed.owner;
    this.repo = parsed.repo;
  }

  async readRepository(): Promise<SourceRepo> {
    const { data } = await this.opts.octokit.rest.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    return {
      owner: data.owner.login,
      repo: data.name,
      defaultBranch: data.default_branch,
    };
  }

  async listPulls(): Promise<SourcePull[]> {
    const only = this.opts.pullNumbers;
    const pulls = only
      ? await Promise.all(
          only.map(
            async (n) =>
              (await this.opts.octokit.rest.pulls.get({ owner: this.owner, repo: this.repo, pull_number: n }))
                .data as unknown as GHPull,
          ),
        )
      : ((await this.opts.octokit.paginate(
          this.opts.octokit.rest.pulls.list,
          { owner: this.owner, repo: this.repo, state: "all", per_page: 100 },
        )) as unknown as GHPull[]);
    const result: SourcePull[] = [];
    for (const p of pulls) {
      let files: string[] = [];
      let hunks: SourceHunk[] | undefined;
      // pulls.list omits additions/deletions; sum them from the file list instead.
      let additions = p.additions;
      let deletions = p.deletions;
      try {
        const filePages = (await this.opts.octokit.paginate(
          this.opts.octokit.rest.pulls.listFiles,
          { owner: this.owner, repo: this.repo, pull_number: p.number, per_page: 100 },
        )) as unknown as Array<{ filename: string; patch?: string; additions?: number; deletions?: number }>;
        files = filePages.map((f) => f.filename);
        additions ??= filePages.reduce((n, f) => n + (f.additions ?? 0), 0);
        deletions ??= filePages.reduce((n, f) => n + (f.deletions ?? 0), 0);
        // `patch` is absent for binary or very large files → a noPatch marker
        // hunk, which the Jev layer routes to human review.
        hunks = filePages.flatMap((f) => parseFilePatch(f.filename, f.patch));
      } catch {
        // Files are best-effort; classification degrades to labels/defaults.
      }
      result.push({
        number: p.number,
        title: p.title,
        author: p.user?.login ?? "unknown",
        createdAt: p.created_at,
        closedAt: p.closed_at,
        mergedAt: p.merged_at,
        state: p.merged_at ? "merged" : p.state === "open" ? "open" : "closed",
        baseBranch: p.base.ref,
        headSha: p.head.sha,
        additions: additions ?? 0,
        deletions: deletions ?? 0,
        changedFiles: p.changed_files ?? files.length,
        labels: p.labels.map((l) => l.name),
        draft: p.draft ?? false,
        files,
        ...(hunks ? { hunks } : {}),
      });
    }
    return result;
  }

  async listReviews(pullNumber: number): Promise<SourceReview[]> {
    const reviews = (await this.opts.octokit.paginate(
      this.opts.octokit.rest.pulls.listReviews,
      { owner: this.owner, repo: this.repo, pull_number: pullNumber, per_page: 100 },
    )) as unknown as GHReview[];
    return reviews.map((r) => ({
      id: r.id,
      author: r.user?.login ?? "unknown",
      submittedAt: r.submitted_at ?? r.updated_at ?? new Date(0).toISOString(),
      state: (r.state.toUpperCase() === "APPROVED"
        ? "APPROVED"
        : r.state.toUpperCase() === "CHANGES_REQUESTED"
          ? "CHANGES_REQUESTED"
          : "COMMENTED") as SourceReview["state"],
      body: r.body ?? null,
      ...(r.commit_id ? { commitId: r.commit_id } : {}),
    }));
  }

  async listReviewComments(pullNumber: number): Promise<SourceReviewComment[]> {
    const comments = (await this.opts.octokit.paginate(
      this.opts.octokit.rest.pulls.listReviewComments,
      { owner: this.owner, repo: this.repo, pull_number: pullNumber, per_page: 100 },
    )) as unknown as GHComment[];
    return comments.map((c) => ({
      id: c.id,
      author: c.user?.login ?? "unknown",
      createdAt: c.created_at,
      path: c.path ?? null,
      body: c.body,
    }));
  }

  /**
   * Lint rule files under `dir` at the tip of `ref` (the default branch),
   * read through the contents API at one pinned commit. Never the pull
   * request head: a pull request can't change the rules it is checked by.
   */
  async readLintRules(dir: string, ref: string): Promise<{ commitSha: string | null; files: LintRuleFile[] } | null> {
    const { data: branch } = await this.opts.octokit.rest.repos.getBranch({ owner: this.owner, repo: this.repo, branch: ref });
    const commitSha = branch.commit.sha;
    const files: LintRuleFile[] = [];
    const walk = async (path: string, depth: number): Promise<boolean> => {
      let entries: Array<{ type: string; path: string; name: string; size?: number }>;
      try {
        const { data } = await this.opts.octokit.rest.repos.getContent({ owner: this.owner, repo: this.repo, path, ref: commitSha });
        if (!Array.isArray(data)) return depth > 0;
        entries = data as typeof entries;
      } catch (err) {
        if ((err as { status?: number }).status === 404) return false;
        throw err;
      }
      for (const e of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
        if (e.name.startsWith(".")) continue;
        if (e.type === "dir" && depth < LINT_MAX_DEPTH) await walk(e.path, depth + 1);
        if (e.type !== "file" || !/\.(md|markdown)$/i.test(e.name) || files.length >= LINT_MAX_FILES) continue;
        const { data } = await this.opts.octokit.rest.repos.getContent({ owner: this.owner, repo: this.repo, path: e.path, ref: commitSha });
        const file = data as { content?: string; encoding?: string };
        if (typeof file.content !== "string" || file.encoding !== "base64") continue;
        files.push({ path: e.path.slice(dir.length + 1), content: Buffer.from(file.content, "base64").toString("utf8") });
      }
      return true;
    };
    const found = await walk(dir, 0);
    return found ? { commitSha, files } : null;
  }

  /**
   * Defect proxies from the issue timeline: cross-referenced PRs whose title
   * reads as a revert/hotfix/follow-up (a "reopened" event is also a signal).
   * Falls back to [] when the timeline API is unavailable.
   */
  async listDefectEvents(pullNumber: number): Promise<SourceDefectEvent[]> {
    try {
      const events = await this.opts.octokit.paginate(
        this.opts.octokit.rest.issues.listEventsForTimeline as never,
        {
          owner: this.owner,
          repo: this.repo,
          issue_number: pullNumber,
          per_page: 100,
          headers: { accept: "application/vnd.github.mockingbird-preview+json" },
        } as never,
      );
      const defects: SourceDefectEvent[] = [];
      for (const e of events as Array<Record<string, unknown>>) {
        const event = e as { event?: string; created_at?: string; source?: { issue?: { title?: string } } };
        if (event.event === "reopened") {
          defects.push({ kind: "reopen", at: event.created_at ?? "", detail: "issue reopened" });
        }
        const title = event.source?.issue?.title ?? "";
        if (event.event === "cross-referenced" && title) {
          if (REVERT_RE.test(title)) {
            defects.push({ kind: "revert", at: event.created_at ?? "", detail: title });
          } else if (FOLLOWUP_RE.test(title)) {
            defects.push({ kind: "followup_fix", at: event.created_at ?? "", detail: title });
          }
        }
      }
      return defects;
    } catch {
      return [];
    }
  }
}
