// The few git calls `pullup preview` needs, through execFile (no shell). Core
// never touches git or the filesystem; this file hands it plain text.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", [...args], { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** `owner/repo` from the origin remote (https or ssh), or null. */
export function repoIdFromRemote(url: string): string | null {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export async function originRepoId(cwd: string): Promise<string | null> {
  try {
    return repoIdFromRemote(await git(cwd, ["remote", "get-url", "origin"]));
  } catch {
    return null;
  }
}

/** The remote's default branch (origin/HEAD), else `main`. */
export async function defaultBase(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim() || "main";
  } catch {
    return "main";
  }
}

export async function revParse(cwd: string, ref: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
}

export async function currentBranch(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    return "HEAD";
  }
}

/**
 * The branch's own changes, like a pull request: `base...head` (three dots,
 * from the merge base), or the staged changes with `staged`.
 */
export async function branchDiff(cwd: string, opts: { base: string; head: string; staged?: boolean }): Promise<string> {
  const common = ["diff", "--no-color", "--no-ext-diff", "-M", "--src-prefix=a/", "--dst-prefix=b/"];
  return git(cwd, opts.staged ? [...common, "--cached"] : [...common, `${opts.base}...${opts.head}`]);
}

/**
 * Text files under `dir` at `ref` (paths relative to `dir`), read from git's
 * object store: what the branch holds, not the working tree. Empty when the
 * folder doesn't exist at that ref.
 */
export async function filesAtRef(cwd: string, ref: string, dir: string): Promise<Array<{ path: string; content: string }>> {
  let listing: string;
  try {
    listing = await git(cwd, ["ls-tree", "-r", "-z", "--name-only", ref, "--", dir]);
  } catch {
    return [];
  }
  const out: Array<{ path: string; content: string }> = [];
  for (const path of listing.split("\0").filter((p) => p.startsWith(`${dir}/`))) {
    out.push({ path: path.slice(dir.length + 1), content: await git(cwd, ["show", `${ref}:${path}`]) });
  }
  return out;
}

/** The commit `ref` points at, or null. */
export async function tryRevParse(cwd: string, ref: string): Promise<string | null> {
  try {
    return await revParse(cwd, ref);
  } catch {
    return null;
  }
}
