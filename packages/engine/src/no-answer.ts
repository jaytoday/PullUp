import type { CheckedSeat } from "./council";
import type { Question } from "@pullup/sdk";
import { extensionById } from "@pullup/extensions";
import { type Config, enabledExtensions, type NoAnswerOption } from "./config";

/**
 * Asking a person, and what happens when no one answers. Pure: the time is
 * always passed in, so tests use a fake clock and the worker uses `Date.now()`.
 *
 * At the deadline the configured option (`ask.perExtension` for the question id,
 * then for its extension, then the extension's own option, else `ask.onNoAnswer`):
 * - `fail`: the question fails with "no answer from <name>";
 * - `follow-council`: pass if most seats said "pass", otherwise fail. It never
 *   passes a question set to "a person decides": that would be the council passing it;
 * - `pass`: the question passes, marked "passed without an answer";
 * - `escalate`: ask `ask.backup` with a fresh deadline; if that also goes
 *   unanswered, `ask.onNoAnswerAfterBackup` applies.
 * The first answer wins. An answer that arrives after the deadline still
 * counts and replaces the no-answer outcome.
 */

export type PersonAnswer = "pass" | "fail";

export interface AskState {
  questionId: string;
  stage: "primary" | "backup";
  /** Everyone asked so far; any of them may answer. */
  asked: string[];
  askedAt: number;
  deadline: number;
  remindedAt: number | null;
  answer: { value: PersonAnswer; by: string; at: number; reason: string } | null;
  noAnswer: { option: Exclude<NoAnswerOption, "escalate">; outcome: PersonAnswer; at: number; reason: string } | null;
}

export type AskAction = { kind: "remind"; to: string } | { kind: "ask"; to: string; deadline: number } | { kind: "cancel-other-channels" };

const minutes = (n: number) => n * 60_000;

/** Who is asked first: the people an extension named for this question (for example its code owners), else `ask.to`. */
export function firstAsked(question: Question, config: Config): string[] {
  return question.askTo?.length ? question.askTo : [config.ask.to];
}

/** The no-answer option for a question. `escalate` without a backup falls back to `fail`. */
export function noAnswerOption(question: Question, config: Config): NoAnswerOption {
  const option = config.ask.perExtension[question.id] ?? config.ask.perExtension[question.extension] ?? question.onNoAnswer ?? config.ask.onNoAnswer;
  return option === "escalate" && !config.ask.backup ? "fail" : option;
}

export function startAsk(question: Question, config: Config, now: number): { state: AskState; actions: AskAction[] } {
  const deadline = now + minutes(config.ask.deadlineMinutes);
  const to = firstAsked(question, config);
  const state: AskState = { questionId: question.id, stage: "primary", asked: to, askedAt: now, deadline, remindedAt: null, answer: null, noAnswer: null };
  return { state, actions: to.map((person) => ({ kind: "ask", to: person, deadline })) };
}

function councilLean(seats: CheckedSeat[], question: Question): PersonAnswer {
  if (!question.councilMayPass) return "fail";
  const passes = seats.filter((s) => s.verdict === "pass").length;
  const validFail = seats.some((s) => s.verdict === "fail" && s.validQuotes.length > 0);
  return passes * 2 > seats.length && !validFail ? "pass" : "fail";
}

/** Move a waiting question along: a reminder at half time, then the no-answer option at the deadline. */
export function tick(state: AskState, question: Question, seats: CheckedSeat[], config: Config, now: number): { state: AskState; actions: AskAction[] } {
  if (state.answer || state.noAnswer) return { state, actions: [] };
  // Everyone asked at this stage: all of the first people (for example several code owners), or the backup.
  const waitingOn = state.stage === "backup" ? [state.asked[state.asked.length - 1]!] : state.asked;
  const current = waitingOn.join(" or ");
  if (now < state.deadline) {
    const half = state.askedAt + (state.deadline - state.askedAt) / 2;
    if (config.ask.remind && state.remindedAt === null && now >= half) {
      return { state: { ...state, remindedAt: now }, actions: waitingOn.map((to) => ({ kind: "remind" as const, to })) };
    }
    return { state, actions: [] };
  }
  const option = state.stage === "backup" ? config.ask.onNoAnswerAfterBackup : noAnswerOption(question, config);
  if (option === "escalate") {
    const backup = config.ask.backup!;
    const deadline = now + minutes(config.ask.deadlineMinutes);
    return {
      state: { ...state, stage: "backup", asked: [...state.asked, backup], askedAt: now, deadline, remindedAt: null },
      actions: [{ kind: "ask", to: backup, deadline }],
    };
  }
  const outcome: PersonAnswer = option === "pass" ? "pass" : option === "fail" ? "fail" : councilLean(seats, question);
  const reason =
    option === "fail"
      ? `No answer from ${current}.`
      : option === "pass"
        ? `Passed without an answer from ${current}.`
        : `No answer from ${current}; followed the council's lean (${outcome}).`;
  return { state: { ...state, noAnswer: { option, outcome, at: now, reason } }, actions: [] };
}

/**
 * Record a person's answer. Accepted only from someone asked, or a repo admin,
 * and only if no one answered first. Late answers (after a no-answer outcome) are accepted.
 */
export function answer(
  state: AskState,
  input: { value: PersonAnswer; by: string; isAdmin: boolean; reason?: string },
  now: number,
): { state: AskState; accepted: boolean; why?: string; actions: AskAction[] } {
  if (!state.asked.includes(input.by) && !input.isAdmin) return { state, accepted: false, why: "Only the people asked or a repo admin can answer.", actions: [] };
  if (state.answer) return { state, accepted: false, why: `Already answered by ${state.answer.by}.`, actions: [] };
  return {
    state: { ...state, answer: { value: input.value, by: input.by, at: now, reason: input.reason ?? "" } },
    accepted: true,
    actions: [{ kind: "cancel-other-channels" }],
  };
}

/** Where a waiting question stands: the person's answer, else the no-answer outcome, else still waiting. */
export function askOutcome(state: AskState): { outcome: PersonAnswer | "ask"; decidedBy: "person" | "no-answer" | null; reason: string } {
  if (state.answer) return { outcome: state.answer.value, decidedBy: "person", reason: `${state.answer.by} answered "${state.answer.value}".${state.answer.reason ? ` ${state.answer.reason}` : ""}` };
  if (state.noAnswer) return { outcome: state.noAnswer.outcome, decidedBy: "no-answer", reason: state.noAnswer.reason };
  const waitingOn = state.stage === "backup" ? [state.asked[state.asked.length - 1]!] : state.asked;
  return { outcome: "ask", decidedBy: null, reason: `Waiting for ${waitingOn.join(" or ")}.` };
}

/** Who a GitHub user is for answering: the person asked (by their configured login, or an extension's mapping such as code owners), or just that login. */
export function personForGithubLogin(config: Config, login: string): string {
  const l = login.toLowerCase();
  if (config.ask.toGithub?.toLowerCase() === l) return config.ask.to;
  if (config.ask.backup && config.ask.backupGithub?.toLowerCase() === l) return config.ask.backup;
  for (const id of enabledExtensions(config)) {
    const person = extensionById(id)?.personForLogin?.(config.extensions[id]!.config, login);
    if (person) return person;
  }
  return `github:${login}`;
}
