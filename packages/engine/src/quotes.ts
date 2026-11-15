import type { ParsedCiRun } from "./ci";
import { parseDiff } from "./diff";

/**
 * An adverse answer counts only with a quote that really appears in the
 * change or the CI logs. Models sometimes invent quotes; this check is plain
 * code. Rules from jaytoday/PullUp@a399ffc:packages/core/src/verify/accept.ts:
 * spacing is ignored, a quote must be at least 6 characters, and a diff quote
 * must be on a changed (added or removed) line.
 */

export interface Citation {
  quote: string;
  source?: string;
}

const MIN_QUOTE = 6;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function quoteChecksOut(citation: Citation, run: ParsedCiRun): boolean {
  // A copied diff line often keeps its leading "+" or "-"; the line's text is what counts.
  const text = norm(citation.quote.replace(/^\s*[+-](?![+-])/, ""));
  if (text.length < MIN_QUOTE) return false;
  const inDiff = parseDiff(run.diff).some((f) => f.lines.some((l) => l.kind !== "context" && norm(l.text).includes(text)));
  const inLog = run.jobs.some((j) => j.attempts.some((a) => norm(a.logExcerpt).includes(text)));
  return inDiff || inLog;
}

/** The citations that check out against the run. */
export function verifiedQuotes(citations: readonly Citation[], run: ParsedCiRun): Citation[] {
  return citations.filter((c) => quoteChecksOut(c, run));
}
