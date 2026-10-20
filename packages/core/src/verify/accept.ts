// Deterministic checks on a verifier's answer. Model output is never trusted
// as-is: a "confirmed" verdict is accepted only when every evidence quote is a
// changed (added or removed) line of the finding's own hunks, at the stated
// path and line, and the fix and reason text pass the free-text screen.
// Anything else is downgraded to "unsure". Pure.

import { screenFreeText } from "../config/screen.js";
import type { HunkRecord } from "../schema/domain.js";
import type { EvidenceItem, FindingVerdict, RawVerdict } from "./types.js";

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const LINE_TOLERANCE = 3;
const MIN_QUOTE = 6;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Changed lines of a hunk with their line number on the side they belong to. */
export function changedLines(h: HunkRecord): Array<{ side: "new" | "old"; line: number; text: string }> {
  const m = HEADER.exec(h.header);
  if (!m || h.noPatch) return [];
  let oldLine = Number(m[1]);
  let newLine = Number(m[2]);
  const out: Array<{ side: "new" | "old"; line: number; text: string }> = [];
  for (const raw of h.patch.split("\n")) {
    if (raw.startsWith("+")) out.push({ side: "new", line: newLine++, text: raw.slice(1) });
    else if (raw.startsWith("-")) out.push({ side: "old", line: oldLine++, text: raw.slice(1) });
    else if (raw.startsWith("\\")) continue;
    else {
      oldLine++;
      newLine++;
    }
  }
  return out;
}

/** Whether one evidence item is a real changed line of these hunks. */
export function evidenceInDiff(e: EvidenceItem, hunks: readonly HunkRecord[]): boolean {
  const quote = norm(e.quote);
  if (quote.length < MIN_QUOTE) return false;
  return hunks
    .filter((h) => h.path === e.path)
    .some((h) => changedLines(h).some((l) => Math.abs(l.line - e.line) <= LINE_TOLERANCE && norm(l.text).includes(quote)));
}

const TEXT_LIMITS = { fix: { maxChars: 400, maxLines: 6 }, reason: { maxChars: 500, maxLines: 8 } };

export function acceptVerdict(raw: RawVerdict, hunks: readonly HunkRecord[], verifierId: string): FindingVerdict {
  const problems: string[] = [];
  const evidence = raw.evidence.slice(0, 5).map((e) => ({ path: e.path, line: Math.trunc(e.line), quote: e.quote.slice(0, 300) }));
  if (raw.verdict === "confirmed") {
    if (evidence.length === 0) problems.push("no evidence");
    for (const e of evidence) if (!evidenceInDiff(e, hunks)) problems.push(`quote at ${e.path}:${e.line} is not a changed line of this finding's hunks`);
  }
  const clean = (text: string | null, opts: { maxChars: number; maxLines: number }, label: string): string | null => {
    if (text === null || text.trim() === "") return null;
    const s = screenFreeText(text, opts);
    if (!s.ok) {
      problems.push(`${label} rejected: ${s.problems.join(", ")}`);
      return null;
    }
    return s.normalized;
  };
  const fix = clean(raw.fix, TEXT_LIMITS.fix, "fix");
  const reason = clean(raw.reason, TEXT_LIMITS.reason, "reason") ?? (raw.error ? `Verifier error: ${raw.error.slice(0, 200)}` : "");
  const accepted = raw.verdict === "confirmed" && problems.length === 0;
  const verdict = raw.verdict === "confirmed" && !accepted ? "unsure" : raw.verdict;
  return {
    verdict,
    accepted,
    // Only accepted evidence is ever shown as quotes.
    evidence: accepted ? evidence : evidence.filter((e) => evidenceInDiff(e, hunks)),
    fix: accepted ? fix : null,
    reason,
    verifierId,
    ...(problems.length > 0 ? { rejected: problems } : {}),
  };
}
