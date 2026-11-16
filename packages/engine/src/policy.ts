import type { Concern } from "./config";
import type { HardFailure } from "./hard-failure";
import type { Citation } from "./quotes";

/**
 * PullUp's fixed rule. The decision runtime advises; this code decides, from
 * the typed answers only, never from the agent's text:
 *
 * - a hard failure fails the run with no model call;
 * - `risky` with a quote that checks out fails the concern, and so does a
 *   person's `risky` (a person needs no quote);
 * - `safe` passes it;
 * - anything else waits for a person: a person review that is still open, a
 *   missing fact, `risky` with no checked quote, a failed call, or (in
 *   Enforce mode) a simulated answer. Enforce mode never passes on simulated
 *   answers.
 *
 * The run fails if any concern fails, waits if any concern waits, and passes
 * otherwise (including when nothing was tricky).
 */

export const CHECK_MODES = ["report_only", "enforce"] as const;
export type CheckMode = (typeof CHECK_MODES)[number];

export interface Assessment {
  concern: Concern;
  provider: string;
  /** decided, or still waiting for a person or a fact, or failed. */
  status: "decided" | "pending_review" | "input_required" | "paused" | "failed";
  /** The answer (provisional when `final` is false); null when there is none. */
  answer: "risky" | "safe" | null;
  final: boolean;
  /** Probability of `risky` when the provider gave one. */
  probability: number | null;
  citations: Citation[];
  /** Citations that checked out against the change and logs. */
  verified: Citation[];
  /** Answered by a demo engine: labeled "simulated" everywhere. */
  synthetic: boolean;
  decisionId: string | null;
  costUsd: number | null;
  /** Who answered inside AskWithAI (fast, reasoning, rules, precedent, a person), when known. */
  answeredBy: string | null;
  error: string | null;
}

/** AskWithAI marks a settled review "person"; PullUp marks a GitHub answer "person:<login>". */
export const isPerson = (answeredBy: string | null) => answeredBy === "person" || !!answeredBy?.startsWith("person:");

export type ConcernOutcome = "pass" | "fail" | "waiting";
export type RunResult = "pass" | "fail" | "waiting";

export function concernOutcome(a: Assessment, mode: CheckMode): { outcome: ConcernOutcome; reason: string } {
  if (a.status === "failed" || a.answer === null) return { outcome: "waiting", reason: `No answer (${a.error ?? a.status}); a person decides.` };
  if (!a.final) return { outcome: "waiting", reason: a.status === "input_required" ? "Waiting for a missing fact." : "Waiting for a person's review." };
  if (mode === "enforce" && a.synthetic) return { outcome: "waiting", reason: "The answer is simulated; Enforce mode waits for a person." };
  if (a.answer === "safe") return { outcome: "pass", reason: "Judged safe." };
  if (isPerson(a.answeredBy)) return { outcome: "fail", reason: `A person judged it risky (${a.answeredBy}).` };
  if (a.verified.length) return { outcome: "fail", reason: `Judged risky: "${a.verified[0]!.quote.slice(0, 120)}"` };
  return { outcome: "waiting", reason: "Judged risky, but no quote checked out against the change or logs; a person decides." };
}

export interface RunDecision {
  result: RunResult;
  reason: string;
  hardFailures: HardFailure[];
  concerns: Array<{ concern: Concern; outcome: ConcernOutcome; reason: string }>;
}

export function decideRun(hardFailures: HardFailure[], assessments: Assessment[], mode: CheckMode): RunDecision {
  if (hardFailures.length) return { result: "fail", reason: hardFailures.map((f) => f.reason).join(" "), hardFailures, concerns: [] };
  const concerns = assessments.map((a) => ({ concern: a.concern, ...concernOutcome(a, mode) }));
  const failed = concerns.filter((c) => c.outcome === "fail");
  if (failed.length) return { result: "fail", reason: failed.map((c) => `${c.concern}: ${c.reason}`).join(" "), hardFailures, concerns };
  const waiting = concerns.filter((c) => c.outcome === "waiting");
  if (waiting.length) return { result: "waiting", reason: `Waiting for a person on ${waiting.map((c) => c.concern).join(", ")}.`, hardFailures, concerns };
  return { result: "pass", reason: concerns.length ? "Every concern was judged safe." : "Nothing tricky: every required check passed and no concern fired.", hardFailures, concerns };
}
