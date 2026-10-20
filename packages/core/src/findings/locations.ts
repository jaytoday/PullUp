// Where a finding sits in the diff. Signal findings carry the unit keys of the
// hunks that raised them (`path#hunkIndex`, or `path#hunkIndex.part` for an
// oversized hunk split into parts); the hunk's `@@ -a,b +c,d @@` header gives
// the line range on the new side of the file. Pure.

import type { HunkRecord } from "../schema/domain.js";
import type { Finding } from "./findings.js";

export interface FindingLocation {
  readonly path: string;
  /** First and last line on the new (right) side of the diff, 1-based. */
  readonly startLine: number;
  readonly endLine: number;
  /** The hunk's content hash, so a location can be matched across runs. */
  readonly hunkHash: string;
  /** False for a deletion-only hunk anchored to the line before it (not a diff line, so not commentable). */
  readonly inDiff: boolean;
}

const HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * The new-side line range of a hunk header, or null when the hunk adds no
 * lines that exist in the new file (a deleted file, or a whole-file marker).
 * A deletion-only hunk is anchored to the line before the deletion.
 */
export function hunkNewRange(header: string): { start: number; end: number } | null {
  const m = HEADER.exec(header);
  if (!m) return null;
  const start = Number(m[1]);
  const count = m[2] === undefined ? 1 : Number(m[2]);
  if (count === 0) return start > 0 ? { start, end: start } : null;
  return { start, end: start + count - 1 };
}

/** `path#3` / `path#3.1` → `{ path, index: 3 }`. Paths may contain `#`, so split on the last one. */
export function parseUnitKey(key: string): { path: string; index: number } | null {
  const at = key.lastIndexOf("#");
  if (at <= 0) return null;
  const index = Number.parseInt(key.slice(at + 1), 10);
  return Number.isFinite(index) ? { path: key.slice(0, at), index } : null;
}

/** The diff locations behind one finding (empty for rule findings and unlocatable hunks), in diff order. */
export function locateFinding(finding: Pick<Finding, "units">, hunks: readonly HunkRecord[]): FindingLocation[] {
  const byKey = new Map(hunks.map((h) => [`${h.path}#${h.index}`, h]));
  const seen = new Set<string>();
  const out: FindingLocation[] = [];
  for (const key of finding.units ?? []) {
    const unit = parseUnitKey(key);
    if (!unit) continue;
    const hunkKey = `${unit.path}#${unit.index}`;
    if (seen.has(hunkKey)) continue;
    seen.add(hunkKey);
    const h = byKey.get(hunkKey);
    if (!h || h.noPatch) continue;
    const range = hunkNewRange(h.header);
    if (!range) continue;
    out.push({ path: h.path, startLine: range.start, endLine: range.end, hunkHash: h.contentHash, inDiff: !/^@@ -\d+(?:,\d+)? \+\d+,0 @@/.test(h.header) });
  }
  return out.sort((a, b) => (a.path === b.path ? a.startLine - b.startLine : a.path.localeCompare(b.path)));
}
