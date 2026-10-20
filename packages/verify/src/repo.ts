// Read-only access to the repository at the pull request head, for the
// verifier's tools. Paths are repo-relative and confined: no absolute paths,
// no "..". Everything returned is file content — data, never instructions.

import type { Octokit } from "@octokit/rest";

export interface RepoReader {
  readFile(path: string, startLine: number | null, endLine: number | null): Promise<string>;
  listDir(path: string): Promise<string[]>;
  searchCode(query: string): Promise<string[]>;
}

const MAX_FILE_CHARS = 40_000;

/** Repo-relative and confined, or null. */
export function safeRepoPath(path: string): string | null {
  const p = path.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (p.startsWith("/") || p.split("/").some((seg) => seg === ".." || seg === "")) return p === "" ? "" : null;
  return p;
}

export function numbered(text: string, startLine: number | null, endLine: number | null): string {
  const lines = text.split("\n");
  const from = Math.max(1, startLine ?? 1);
  const to = Math.min(lines.length, endLine ?? lines.length);
  const out = lines.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join("\n");
  return out.length > MAX_FILE_CHARS ? `${out.slice(0, MAX_FILE_CHARS)}\n… (truncated; read a narrower line range)` : out;
}

/** A RepoReader over the GitHub contents and code-search APIs, pinned to one commit. */
export function githubRepoReader(octokit: Octokit, repoId: string, ref: string): RepoReader {
  const [owner, repo] = repoId.split("/") as [string, string];
  return {
    async readFile(path, startLine, endLine) {
      const p = safeRepoPath(path);
      if (!p) throw new Error(`path not allowed: ${path}`);
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: p, ref });
      if (Array.isArray(data) || data.type !== "file" || !("content" in data)) throw new Error(`${p} is not a file`);
      return numbered(Buffer.from(data.content, "base64").toString("utf8"), startLine, endLine);
    },
    async listDir(path) {
      const p = safeRepoPath(path);
      if (p === null) throw new Error(`path not allowed: ${path}`);
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: p, ref });
      if (!Array.isArray(data)) throw new Error(`${p} is not a directory`);
      return data.map((e) => (e.type === "dir" ? `${e.path}/` : e.path)).slice(0, 200);
    },
    async searchCode(query) {
      // Code search covers the default branch, not the head commit; results are leads to read, not facts.
      const q = query.replace(/[^\p{L}\p{N}_.\- ]/gu, " ").trim().slice(0, 100);
      if (!q) return [];
      const { data } = await octokit.rest.search.code({ q: `${q} repo:${owner}/${repo}`, per_page: 20 });
      return data.items.map((i) => i.path);
    },
  };
}
