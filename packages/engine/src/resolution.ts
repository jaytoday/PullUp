import type { ParsedCiRun } from "./ci";
import { checkSeat, type CheckedSeat, type Council } from "./council";
import type { Config } from "./config";
import { findHardFailures, type HardFailure } from "./hard-failure";
import type { Question } from "./question";
import { findQuestions } from "./triggers";

/**
 * The resolution rule. The council advises; this code decides. Per question:
 * 1. any seat "fail" with a quote that checks out → the question fails;
 * 2. every seat "pass" at `passStrength` or more, and the trigger allows a
 *    council pass → the question passes;
 * 3. otherwise → ask a person.
 * A person's answer, once given, decides the question.
 * Run: a hard failure fails with no council call; no question passes with no
 * council call; then any failed question fails, any open one waits, else pass.
 */

export type QuestionOutcome = "pass" | "fail" | "ask";
export type PersonAnswer = "pass" | "fail";

export interface ResolvedQuestion {
  question: Question;
  seats: CheckedSeat[];
  outcome: QuestionOutcome;
  /** Who decided: the council, or a person. */
  decidedBy: "council" | "person" | null;
  reason: string;
}

export function resolveQuestion(question: Question, seats: CheckedSeat[], config: Config, person?: PersonAnswer): ResolvedQuestion {
  const base = { question, seats };
  if (person) return { ...base, outcome: person, decidedBy: "person", reason: `A person answered "${person}".` };
  const failing = seats.find((s) => s.verdict === "fail" && s.validQuotes.length > 0);
  if (failing) return { ...base, outcome: "fail", decidedBy: "council", reason: `${failing.seat.split(":")[0]} found a problem: ${failing.reason}` };
  const { passStrength, needsPersonBlocksPass } = config.council;
  const strongPasses = seats.filter((s) => s.verdict === "pass" && s.strength >= passStrength).length;
  const councilPass = needsPersonBlocksPass
    ? seats.length > 0 && strongPasses === seats.length
    : strongPasses * 2 > seats.length && seats.every((s) => s.verdict !== "fail");
  if (councilPass && question.councilMayPass) {
    return { ...base, outcome: "pass", decidedBy: "council", reason: `The council passed it (${strongPasses} of ${seats.length} seats, strength ${passStrength} or more).` };
  }
  const why = councilPass ? "this trigger needs a person to decide" : "the council did not agree clearly";
  return { ...base, outcome: "ask", decidedBy: null, reason: `Asking a person: ${why}.` };
}

export type RunResult = "pass" | "fail" | "waiting";

export interface RunDecision {
  result: RunResult;
  reason: string;
  hardFailures: HardFailure[];
  questions: ResolvedQuestion[];
  /** Council calls made (one per seat per question). */
  councilCalls: number;
}

export function combine(questions: ResolvedQuestion[]): { result: RunResult; reason: string } {
  const failed = questions.filter((q) => q.outcome === "fail");
  if (failed.length) return { result: "fail", reason: failed.map((q) => q.reason).join(" ") };
  const open = questions.filter((q) => q.outcome === "ask");
  if (open.length) return { result: "waiting", reason: `Waiting for a person on ${open.length} question(s).` };
  return { result: "pass", reason: questions.length ? "Every question passed." : "Nothing tricky: every check passed and no trigger fired." };
}

export async function decideRun(
  run: ParsedCiRun,
  config: Config,
  council: Council,
  people: Partial<Record<string, PersonAnswer>> = {},
): Promise<RunDecision> {
  const hardFailures = findHardFailures(run, config);
  if (hardFailures.length) {
    return { result: "fail", reason: hardFailures.map((f) => f.reason).join(" "), hardFailures, questions: [], councilCalls: 0 };
  }
  const found = findQuestions(run, config);
  let councilCalls = 0;
  const questions = await Promise.all(
    found.map(async (question) => {
      const person = people[question.id];
      if (person) return resolveQuestion(question, [], config, person);
      const raw = await council(question, run, config.council.seats);
      councilCalls += raw.length;
      return resolveQuestion(question, raw.map((r) => checkSeat(r, question, run)), config);
    }),
  );
  return { ...combine(questions), hardFailures, questions, councilCalls };
}
