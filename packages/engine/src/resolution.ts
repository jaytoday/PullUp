import type { ParsedCiRun, Question } from "@pullup/sdk";
import { checkSeat, type CheckedSeat, type Council, type RawSeatAnswer } from "./council";
import type { Config } from "./config";
import { findHardFailures, type HardFailure } from "./hard-failure";
import { type HostResult, planScreens, runExtensions } from "./host";
import { askScreens, type Screener } from "./screens";
import { askOutcome, type AskState } from "./no-answer";

/**
 * The resolution rule. The council advises; this code decides. Per question:
 * 1. any seat "fail" with a quote that checks out → the question fails;
 * 2. every seat "pass" at `passStrength` or more, and the trigger allows a
 *    council pass → the question passes;
 * 3. otherwise → ask a person.
 * A person's answer, or the no-answer option, then settles an "ask" (`settle`).
 * Run: a hard failure fails with no council call; no question passes with no
 * council call; then any failed question fails, any open one waits, else pass.
 * Shadow questions are decided the same way but never count.
 */

export type QuestionOutcome = "pass" | "fail" | "ask";

export interface ResolvedQuestion {
  question: Question;
  seats: CheckedSeat[];
  outcome: QuestionOutcome;
  /** Who decided: the council, a person, or the no-answer option. */
  decidedBy: "council" | "person" | "no-answer" | null;
  reason: string;
}

export function resolveQuestion(question: Question, seats: CheckedSeat[], config: Config): ResolvedQuestion {
  const base = { question, seats };
  if (question.skipCouncil && !seats.length) {
    const reason = question.shadow ? "Shadow: would ask a person (not sent to the council)." : "Asking a person straight away: more questions than the council takes in one run.";
    return { ...base, outcome: "ask", decidedBy: null, reason };
  }
  const failing = seats.find((s) => s.verdict === "fail" && s.validQuotes.length > 0);
  if (failing) return { ...base, outcome: "fail", decidedBy: "council", reason: `${failing.seat.split(":")[0]} found a problem: ${failing.reason}` };
  const { passStrength, needsPersonBlocksPass } = config.council;
  const strongPasses = seats.filter((s) => s.verdict === "pass" && s.strength >= passStrength).length;
  const councilPass = needsPersonBlocksPass
    ? seats.length > 0 && strongPasses === seats.length
    : strongPasses * 2 > seats.length;
  if (councilPass && question.councilMayPass) {
    return { ...base, outcome: "pass", decidedBy: "council", reason: `The council passed it (${strongPasses} of ${seats.length} seats, strength ${passStrength} or more).` };
  }
  const why = councilPass ? "this question needs a person to decide" : "the council did not agree clearly";
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
  /** What the council calls cost, in US dollars. */
  costUsd: number;
  /** What each extension added (facts, notes, annotations, relaxations) and the composition hash. Null on a hard failure. */
  extensions: (Omit<HostResult, "questions"> & { screenCalls: number }) | null;
}

/** Apply each waiting question's ask state: a person's answer or the no-answer outcome replaces "ask". */
export function settle(questions: ResolvedQuestion[], asks: Partial<Record<string, AskState>>): ResolvedQuestion[] {
  return questions.map((q) => {
    const state = asks[q.question.id];
    if (q.outcome !== "ask" || !state) return q;
    const { outcome, decidedBy, reason } = askOutcome(state);
    return { ...q, outcome, decidedBy, reason };
  });
}

/** The run's result, in a fixed order: any failed question > any open question > pass. Shadow questions never count. */
export function combine(questions: ResolvedQuestion[]): { result: RunResult; reason: string } {
  const counted = questions.filter((q) => !q.question.shadow);
  const shadow = questions.length - counted.length;
  const failed = counted.filter((q) => q.outcome === "fail");
  if (failed.length) return { result: "fail", reason: failed.map((q) => q.reason).join(" ") };
  const open = counted.filter((q) => q.outcome === "ask");
  if (open.length) return { result: "waiting", reason: `Waiting for a person on ${open.length} question(s).` };
  const passed = counted.length ? "Every question passed." : "Nothing tricky: every check passed and no trigger fired.";
  return { result: "pass", reason: shadow ? `${passed} (${shadow} Shadow question(s) shown, not counted.)` : passed };
}

export async function decideRun(
  run: ParsedCiRun,
  config: Config,
  council: Council,
  options: { now?: number; only?: string[]; screener?: Screener | null } = {},
): Promise<RunDecision> {
  const hardFailures = findHardFailures(run, config);
  if (hardFailures.length) {
    return { result: "fail", reason: hardFailures.map((f) => f.reason).join(" "), hardFailures, questions: [], councilCalls: 0, costUsd: 0, extensions: null };
  }
  const now = options.now ?? Date.now();
  const { planned, errors } = planScreens(run, config, { now, only: options.only });
  const screened = planned.length ? await askScreens(planned, run, options.screener ?? null, config.screens.maxPerRun) : { answers: new Map(), calls: 0, costUsd: 0 };
  const { questions: found, ...extensions } = runExtensions(run, config, { now, only: options.only, screens: screened.answers, planErrors: errors });
  let councilCalls = 0;
  let costUsd = screened.costUsd;
  const questions = await Promise.all(
    found.map(async (question) => {
      if (question.skipCouncil) return resolveQuestion(question, [], config);
      const seats = config.council.seats;
      councilCalls += seats.length;
      const raw = await council(question, run, seats).catch((error: Error): RawSeatAnswer[] => seats.map((seat) => ({ seat, answer: null, error: error.message })));
      // Exactly one answer per configured seat: a seat with no answer counts as a failed call, extra answers are ignored.
      const answers = seats.map((seat) => raw.find((r) => r.seat === seat) ?? { seat, answer: null, error: "no answer from this seat" });
      costUsd += raw.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      return resolveQuestion(question, answers.map((r) => checkSeat(r, question, run)), config);
    }),
  );
  return { ...combine(questions), hardFailures, questions, councilCalls, costUsd, extensions: { ...extensions, screenCalls: screened.calls } };
}
