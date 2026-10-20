// Parses `git diff` output into per-file patches shaped like GitHub's
// (the hunk text from the first `@@`), so the same hunk parser and signal
// units apply to a local branch as to a pull request. Pure.

import type { SourceHunk } from "../ingest/source.js";
import { parseFilePatch } from "../signals/hunks.js";

export interface DiffFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "renamed";
  /** GitHub-style patch (from the first hunk header), or null for binary files. */
  readonly patch: string | null;
  readonly additions: number;
  readonly deletions: number;
}

const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p);

export function parseGitDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const blocks = diff.split(/^diff --git /m).slice(1);
  for (const block of blocks) {
    const lines = block.split("\n");
    const m = /^"?a\/(.+?)"? "?b\/(.+?)"?$/.exec(lines[0] ?? "");
    let oldPath = m ? unquote(m[1]!) : "";
    let newPath = m ? unquote(m[2]!) : "";
    let status: DiffFile["status"] = "modified";
    let binary = false;
    let firstHunk = -1;
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i]!;
      if (l.startsWith("@@")) {
        firstHunk = i;
        break;
      }
      if (l.startsWith("new file mode")) status = "added";
      else if (l.startsWith("deleted file mode")) status = "deleted";
      else if (l.startsWith("rename from ")) {
        status = "renamed";
        oldPath = l.slice("rename from ".length);
      } else if (l.startsWith("rename to ")) newPath = l.slice("rename to ".length);
      else if (l.startsWith("Binary files ") || l.startsWith("GIT binary patch")) binary = true;
      else if (l.startsWith("+++ ") && l !== "+++ /dev/null") newPath = unquote(l.slice(4)).replace(/^b\//, "");
      else if (l.startsWith("--- ") && l !== "--- /dev/null") oldPath = unquote(l.slice(4)).replace(/^a\//, "");
    }
    const body = firstHunk >= 0 ? lines.slice(firstHunk) : [];
    while (body.length > 0 && body[body.length - 1] === "") body.pop();
    const patch = binary || body.length === 0 ? null : body.join("\n");
    let additions = 0;
    let deletions = 0;
    for (const l of body) {
      if (l.startsWith("+")) additions++;
      else if (l.startsWith("-")) deletions++;
    }
    const path = status === "deleted" ? oldPath : newPath;
    if (path) files.push({ path, status, patch, additions, deletions });
  }
  return files;
}

/** The diff's hunks, numbered per file exactly like the live ingest. */
export function diffHunks(files: readonly DiffFile[]): SourceHunk[] {
  return files.flatMap((f) => parseFilePatch(f.path, f.patch));
}
