import type { DiffFile, DiffLine } from "./diff";

/** Added and removed lines of a file (context lines left out). */
export function changedLines(file: DiffFile): DiffLine[] {
  return file.lines.filter((l) => l.kind !== "context");
}

/** The line number to point at for a diff line: its new line, or its old line if it was removed. */
export function lineNumber(line: DiffLine): number | null {
  return line.newLine ?? line.oldLine;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A line that defines `name`: a function, method, class, const or exported binding (TypeScript, JavaScript, Python, Go, Rust). */
export function definesSymbol(text: string, name: string): boolean {
  const n = escape(name);
  return new RegExp(
    `(?:\\bfunction\\*?\\s+${n}\\b|\\b(?:const|let|var|class|def|fn|func|interface|type)\\s+${n}\\b|^\\s*(?:export\\s+)?(?:async\\s+)?${n}\\s*[(=:]|\\bfunc\\s+\\([^)]*\\)\\s*${n}\\b|^\\s*(?:public|private|protected|static|async|\\s)*${n}\\s*\\([^)]*\\)\\s*[:{])`,
  ).test(text);
}

/**
 * Whether a changed line is inside the function `name`, as far as the diff can
 * tell: the hunk's function heading names it, or the line itself defines it.
 * Approximate (git finds the heading with a line pattern, not a parser).
 */
export function inSymbol(line: DiffLine, name: string): boolean {
  if (definesSymbol(line.text, name)) return true;
  return line.section !== null && definesSymbol(line.section, name);
}
