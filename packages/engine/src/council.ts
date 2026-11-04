import { z } from "zod";
import type { ParsedCiRun } from "./ci";
import { parseDiff } from "./diff";
import type { Question } from "./question";

/**
 * The council's answers are never trusted as given. Each seat's answer must
 * have the exact shape below; a "fail" counts only when at least one of its
 * quotes really appears in the source it names. Anything else becomes
 * "needs-person". The quote rule follows PullUp's verifier
 * (code/pullup packages/core/src/verify/accept.ts at commit a399ffc): spacing is
 * ignored, a quote must be at least 6 characters, and a diff quote must be on
 * a changed (added or removed) line.
 */

export const seatAnswerSchema = z.object({
  verdict: z.enum(["pass", "fail", "needs-person"]),
  strength: z.number().int().min(1).max(5),
  reason: z.string().max(2000),
  quotes: z.array(z.object({ source: z.enum(["diff", "log", "report"]), text: z.string().max(1000) })).max(8),
});
export type SeatAnswer = z.infer<typeof seatAnswerSchema>;

/** What came back from one seat's call: an answer of unknown shape, or the error. */
export interface RawSeatAnswer {
  seat: string;
  answer: unknown;
  error?: string;
  /** What the call cost and took, when it reached WithAI. */
  costUsd?: number;
  durationMs?: number;
}

/** A seat's answer after the checks; `verdict` is what the resolution rule uses. */
export interface CheckedSeat {
  seat: string;
  verdict: SeatAnswer["verdict"];
  strength: number;
  reason: string;
  validQuotes: SeatAnswer["quotes"];
  /** Why the answer was downgraded or a quote dropped, if it was. */
  problems: string[];
}

/** One seat call per seat viewpoint for one question. Real (WithAI) or recorded. */
export type Council = (question: Question, run: ParsedCiRun, seats: string[]) => Promise<RawSeatAnswer[]>;

const MIN_QUOTE = 6;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function quoteChecksOut(quote: SeatAnswer["quotes"][number], question: Question, run: ParsedCiRun): boolean {
  // Seats often copy a diff line with its leading "+" or "-"; the line's text is what counts.
  const text = norm(quote.source === "diff" ? quote.text.replace(/^\s*[+-](?![+-])/, "") : quote.text);
  if (text.length < MIN_QUOTE) return false;
  if (quote.source === "diff") {
    return parseDiff(run.diff).some((f) => f.lines.some((l) => l.kind !== "context" && norm(l.text).includes(text)));
  }
  if (quote.source === "log") {
    return run.jobs.some((j) => j.attempts.some((a) => norm(a.logExcerpt).includes(text)));
  }
  return question.evidence.some((e) => e.source === "report" && norm(e.text).includes(text));
}

export function checkSeat(raw: RawSeatAnswer, question: Question, run: ParsedCiRun): CheckedSeat {
  const parsed = raw.error ? null : seatAnswerSchema.safeParse(raw.answer);
  if (!parsed?.success) {
    const problem = raw.error ? `call failed: ${raw.error}` : `answer has the wrong shape: ${parsed?.error.issues[0]?.message ?? "unknown"}`;
    return { seat: raw.seat, verdict: "needs-person", strength: 0, reason: "", validQuotes: [], problems: [problem] };
  }
  const answer = parsed.data;
  const validQuotes = answer.quotes.filter((q) => quoteChecksOut(q, question, run));
  const problems = answer.quotes.filter((q) => !validQuotes.includes(q)).map((q) => `quote not found in the ${q.source}: "${q.text.slice(0, 80)}"`);
  if (answer.verdict === "fail" && validQuotes.length === 0) {
    problems.push("a fail with no quote that checks out counts as needs-person");
    return { seat: raw.seat, verdict: "needs-person", strength: answer.strength, reason: answer.reason, validQuotes, problems };
  }
  return { seat: raw.seat, verdict: answer.verdict, strength: answer.strength, reason: answer.reason, validQuotes, problems };
}
