// Adapted from jaytoday/PullUp@a399ffc:packages/core/src/signals/hunks.ts:
// splits a whole unified diff into files and hunks, and keeps line numbers so
// evidence can point at a file and line.

export interface DiffLine {
  kind: "add" | "remove" | "context";
  text: string;
  /** Line number in the new file (added and context lines). */
  newLine: number | null;
  /** Line number in the old file (removed and context lines). */
  oldLine: number | null;
  /**
   * The function heading git prints after the hunk header (`@@ -1 +1 @@ function verify(`),
   * or null. It names the function the hunk is in, roughly: git finds it with a simple
   * line pattern, not a parser.
   */
  section: string | null;
}

export interface DiffFile {
  path: string;
  /** The path before the change; differs from `path` for a rename, null for a new file. */
  oldPath: string | null;
  status: "added" | "deleted" | "modified";
  lines: DiffLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const stripPrefix = (p: string) => p.replace(/^[ab]\//, "");

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;
  // Lines still to read in the current hunk, from its header. Counting them is
  // what tells a removed "-- comment" line apart from the next file's header.
  let oldLeft = 0;
  let newLeft = 0;
  let section: string | null = null;
  const lines = diff.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const inHunk = oldLeft > 0 || newLeft > 0;
    if (!inHunk && line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
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
      i++;
      continue;
    }
    const header = inHunk ? null : HUNK_HEADER.exec(line);
    if (header && file) {
      oldLine = Number(header[1]);
      oldLeft = Number(header[2] ?? 1);
      newLine = Number(header[3]);
      newLeft = Number(header[4] ?? 1);
      section = header[5]?.trim() || null;
      continue;
    }
    if (!file || !inHunk) continue;
    if (line.startsWith("+")) {
      file.lines.push({ kind: "add", text: line.slice(1), newLine: newLine++, oldLine: null, section });
      newLeft--;
    } else if (line.startsWith("-")) {
      file.lines.push({ kind: "remove", text: line.slice(1), newLine: null, oldLine: oldLine++, section });
      oldLeft--;
    } else if (line.startsWith(" ") || line === "") {
      // A context line; some tools drop the leading space of an empty one.
      file.lines.push({ kind: "context", text: line.slice(1), newLine: newLine++, oldLine: oldLine++, section });
      oldLeft--;
      newLeft--;
    }
  }
  return files;
}
