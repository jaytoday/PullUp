// Adapted from PullUp (code/pullup) packages/core/src/signals/hunks.ts at commit a399ffc:
// splits a whole unified diff into files and hunks, and keeps line numbers so
// evidence can point at a file and line.

export interface DiffLine {
  kind: "add" | "remove" | "context";
  text: string;
  /** Line number in the new file (added and context lines). */
  newLine: number | null;
  /** Line number in the old file (removed and context lines). */
  oldLine: number | null;
}

export interface DiffFile {
  path: string;
  /** The path before the change; differs from `path` for a rename, null for a new file. */
  oldPath: string | null;
  status: "added" | "deleted" | "modified";
  lines: DiffLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const stripPrefix = (p: string) => p.replace(/^[ab]\//, "");

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const lines = diff.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      const from = line.slice(4).trim();
      const to = lines[i + 1]!.slice(4).trim();
      const deleted = to === "/dev/null";
      const added = from === "/dev/null";
      file = {
        path: stripPrefix(deleted ? from : to),
        oldPath: added ? null : stripPrefix(from),
        status: added ? "added" : deleted ? "deleted" : "modified",
        lines: [],
      };
      files.push(file);
      inHunk = false;
      i++;
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header && file) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!file || !inHunk) continue;
    if (line.startsWith("+")) file.lines.push({ kind: "add", text: line.slice(1), newLine: newLine++, oldLine: null });
    else if (line.startsWith("-")) file.lines.push({ kind: "remove", text: line.slice(1), newLine: null, oldLine: oldLine++ });
    else if (line.startsWith(" ")) file.lines.push({ kind: "context", text: line.slice(1), newLine: newLine++, oldLine: oldLine++ });
  }
  return files;
}
