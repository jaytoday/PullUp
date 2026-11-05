import { type AskAction, type AskState, answer, appendEvidence, type Config, type PersonAnswer, personForGithubLogin, type ResolvedQuestion, startAsk, storedConfig, storedDecision, tick } from "@pullup/engine";
import { sendComment, type SenderDeps } from "@pullup/github";
import type { CreateQuestionInput, PersonQuestion } from "@withai/client";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { asks, runs } from "@/lib/db/schema";
import { evidenceStore } from "./stores";

/**
 * Asking a person (active mode only). The engine decides when to ask, remind,
 * escalate and what happens with no answer; this module carries it out:
 * WithAI questions (email, phone or a WithAI member), a reminder comment on
 * the pull request, and answers from WithAI, the check run's Pass / Fail
 * buttons or a `/pullup pass|fail <reason>` comment. The first answer wins;
 * the other WithAI questions are cancelled.
 */

/** The part of `WithAIClient` used here, so tests can pass a fake. */
export interface AskClient {
  askPerson(input: CreateQuestionInput): Promise<PersonQuestion>;
  getQuestion(id: string): Promise<PersonQuestion>;
  cancelQuestion(id: string): Promise<PersonQuestion>;
}

export interface AskDeps {
  withai: AskClient | null;
  sender: SenderDeps;
  /** The CI policy skill, so answers come back as its labels. */
  skillId: () => Promise<string | null>;
  now: () => Date;
}

type Run = typeof runs.$inferSelect;
type AskRow = typeof asks.$inferSelect;

/** WithAI keeps a question open this long after PullUp's deadline, so a late answer still arrives and replaces the no-answer outcome. */
const LATE_ANSWER_DAYS = 7;

export function recipient(to: string): CreateQuestionInput["to"] {
  if (to.includes("@")) return { email: to };
  if (/^\+\d{7,15}$/.test(to)) return { phone: to };
  return { userId: to };
}

const record = (run: Run, kind: "asked" | "answered", payload: unknown, now: Date) =>
  appendEvidence(evidenceStore, { scope: run.repo, runId: run.id, kind, at: now.toISOString(), payload });

function details(q: ResolvedQuestion, run: Run): string {
  const lines = [`${run.repo}${run.pull ? ` pull request #${run.pull}` : ""} at ${run.headSha.slice(0, 7)}.`, q.question.summary, "", "Evidence:"];
  for (const e of q.question.evidence) lines.push(`- ${e.where}${e.line ? `:${e.line}` : ""}: ${e.text}`);
  lines.push("", "The council:");
  for (const s of q.seats) lines.push(`- ${s.seat.split(":")[0]}: ${s.verdict} (strength ${s.strength}). ${s.reason}`);
  return lines.join("\n").slice(0, 4000);
}

async function act(run: Run, row: AskRow, q: ResolvedQuestion, config: Config, actions: AskAction[], deps: AskDeps): Promise<AskRow["withai"]> {
  let withai = [...row.withai];
  for (const action of actions) {
    if (action.kind === "ask") {
      let sent: { id: string } | null = null;
      let problem: string | null = deps.withai ? null : "WithAI is not configured";
      if (deps.withai) {
        try {
          const skillId = await deps.skillId();
          sent = await deps.withai.askPerson({
            prompt: `PullUp: ${q.question.prompt}`.slice(0, 500),
            details: details(q, run),
            options: [
              { id: "pass", label: "Pass" },
              { id: "fail", label: "Fail" },
            ],
            allowText: true,
            to: recipient(action.to),
            deadline: new Date(action.deadline + LATE_ANSWER_DAYS * 86_400_000).toISOString(),
            ...(skillId ? { skillId } : {}),
            case: { repo: run.repo, headSha: run.headSha, pull: run.pull, extension: q.question.extension, questionId: q.question.id, question: q.question.summary },
            ...(process.env.PULLUP_URL ? { webhookUrl: `${process.env.PULLUP_URL.replace(/\/+$/, "")}/api/withai/webhook` } : {}),
          });
          withai.push({ id: sent.id, to: action.to, open: true });
        } catch (err) {
          problem = (err as Error).message;
        }
      }
      // The check run (with its buttons) and a `/pullup` comment still work when WithAI could not be reached.
      await record(run, "asked", { question: q.question.id, to: action.to, deadline: new Date(action.deadline).toISOString(), withaiQuestion: sent?.id ?? null, problem }, deps.now());
    } else if (action.kind === "remind") {
      if (run.pull !== null) {
        const who = action.to === config.ask.to && config.ask.toGithub ? `@${config.ask.toGithub}` : action.to === config.ask.backup && config.ask.backupGithub ? `@${config.ask.backupGithub}` : action.to;
        await sendComment(deps.sender, run.id, { repo: run.repo, issue: run.pull, body: `${who} PullUp is waiting for your answer: ${q.question.prompt} Answer with the Pass / Fail buttons on the PullUp check, by email, or comment \`/pullup pass <reason>\` or \`/pullup fail <reason>\`.` });
      }
    } else {
      for (const w of withai.filter((x) => x.open)) {
        await deps.withai?.cancelQuestion(w.id).catch(() => undefined);
      }
      withai = withai.map((w) => ({ ...w, open: false }));
    }
  }
  return withai;
}

const sameAsk = (row: AskRow) => and(eq(asks.runId, row.runId), eq(asks.questionId, row.questionId));

/** Write a new state only if no one changed the ask since `row` was read. False means someone else got there first. */
async function saveState(row: AskRow, state: AskState, now: Date): Promise<boolean> {
  const done = await db
    .update(asks)
    .set({ state, open: state.answer === null, version: row.version + 1, updatedAt: now })
    .where(and(sameAsk(row), eq(asks.version, row.version)))
    .returning();
  return done.length === 1;
}

async function saveWithai(row: AskRow, withai: AskRow["withai"]) {
  await db.update(asks).set({ withai }).where(sameAsk(row));
}

const questionsOf = (run: Run): ResolvedQuestion[] => (run.decision ? storedDecision(run.decision).questions : []);
const configOf = (run: Run): Config => storedConfig(run.config);

/** Start an ask for each of the run's questions that needs a person and has none yet. Shadow questions are never asked. */
export async function ensureAsks(run: Run, deps: AskDeps): Promise<void> {
  const config = configOf(run);
  const existing = new Set((await db.select().from(asks).where(eq(asks.runId, run.id))).map((a) => a.questionId));
  for (const q of questionsOf(run).filter((x) => x.outcome === "ask" && !x.question.shadow && !existing.has(x.question.id))) {
    const now = deps.now();
    const { state, actions } = startAsk(q.question, config, now.getTime());
    const [row] = await db.insert(asks).values({ runId: run.id, questionId: q.question.id, state, updatedAt: now }).onConflictDoNothing().returning();
    if (!row) continue;
    await saveWithai(row, await act(run, row, q, config, actions, deps));
  }
}

export async function loadAsks(runId: string): Promise<Record<string, AskState>> {
  return Object.fromEntries((await db.select().from(asks).where(eq(asks.runId, runId))).map((a) => [a.questionId, a.state as AskState]));
}

/**
 * A person's answer to every open question of a run. `by` is the person
 * (as configured in `ask.to` / `ask.backup`), `isAdmin` lets a repo admin answer.
 * Returns how many questions took the answer, and why not when none did.
 */
export async function recordAnswer(run: Run, input: { value: PersonAnswer; by: string; isAdmin: boolean; reason: string; via: string; questionId?: string }, deps: AskDeps): Promise<{ accepted: number; why?: string }> {
  const config = configOf(run);
  const rows = (await db.select().from(asks).where(and(eq(asks.runId, run.id), eq(asks.open, true)))).filter((r) => !input.questionId || r.questionId === input.questionId);
  if (!rows.length) return { accepted: 0, why: "Nothing is waiting for an answer on this run." };
  let accepted = 0;
  let why: string | undefined;
  for (const row of rows) {
    const now = deps.now();
    const result = answer(row.state as AskState, { value: input.value, by: input.by, isAdmin: input.isAdmin, reason: input.reason }, now.getTime());
    if (!result.accepted) {
      why = result.why;
      continue;
    }
    // Two answers at the same moment: only the first write wins.
    if (!(await saveState(row, result.state, now))) {
      why = "Someone else answered first.";
      continue;
    }
    accepted++;
    const q = questionsOf(run).find((x) => x.question.id === row.questionId)!;
    await record(run, "answered", { question: row.questionId, value: input.value, by: input.by, via: input.via, admin: input.isAdmin && !(row.state as AskState).asked.includes(input.by), reason: input.reason }, now);
    await saveWithai(row, await act(run, row, q, config, result.actions, deps));
  }
  return accepted ? { accepted } : { accepted, why };
}

/** A GitHub user pressed Pass / Fail or commented `/pullup`: map them to the person asked, or check they are a repo admin. */
export async function recordGithubAnswer(run: Run, login: string, value: PersonAnswer, reason: string, via: string, deps: AskDeps & { permission: (repo: string, login: string) => Promise<string> }) {
  const by = personForGithubLogin(configOf(run), login);
  const isAdmin = by.startsWith("github:") ? (await deps.permission(run.repo, login)) === "admin" : false;
  return recordAnswer(run, { value, by, isAdmin, reason, via }, deps);
}

/** `/pullup pass <reason>` or `/pullup fail <reason>` at the start of a comment. */
export function parsePullupCommand(body: string): { value: PersonAnswer; reason: string } | null {
  const m = /^\s*\/pullup\s+(pass|fail)\b[ \t]*(.*)/i.exec(body);
  return m ? { value: m[1]!.toLowerCase() as PersonAnswer, reason: m[2]!.trim() } : null;
}

/** The newest run of a pull request, for `/pullup` comments. */
export async function latestRunForPull(repo: string, pull: number): Promise<Run | null> {
  const [run] = await db.select().from(runs).where(and(eq(runs.repo, repo), eq(runs.pull, pull))).orderBy(desc(runs.firstSeenAt)).limit(1);
  return run ?? null;
}

/**
 * The worker's minute: for each unanswered ask, look for an answer in WithAI
 * (in case its webhook did not arrive), then move the clock (reminder,
 * escalation, the no-answer option). Returns the runs whose outcome may have changed.
 */
export async function tickAsks(deps: AskDeps): Promise<Set<string>> {
  const changed = new Set<string>();
  for (const row of await db.select().from(asks).where(eq(asks.open, true))) {
    const [run] = await db.select().from(runs).where(eq(runs.id, row.runId));
    if (!run) continue;
    for (const w of row.withai.filter((x) => x.open)) {
      const q = await deps.withai?.getQuestion(w.id).catch(() => null);
      const value = q?.status === "answered" ? q.answer?.optionId : undefined;
      if (value === "pass" || value === "fail") {
        const r = await recordAnswer(run, { value, by: w.to, isAdmin: false, reason: q?.answer?.text ?? "", via: "withai", questionId: row.questionId }, deps);
        if (r.accepted) changed.add(run.id);
      }
    }
    const [fresh] = await db.select().from(asks).where(and(eq(asks.runId, row.runId), eq(asks.questionId, row.questionId)));
    if (!fresh?.open) continue;
    const state = fresh.state as AskState;
    const q = questionsOf(run).find((x) => x.question.id === row.questionId);
    if (!q || state.noAnswer) continue;
    const now = deps.now();
    const next = tick(state, q.question, q.seats, configOf(run), now.getTime());
    if (next.state === state) continue;
    // An answer that arrived in between wins; the clock looks again next minute.
    if (!(await saveState(fresh, next.state, now))) continue;
    await saveWithai(fresh, await act(run, fresh, q, configOf(run), next.actions, deps));
    if (next.state.noAnswer) changed.add(run.id);
  }
  return changed;
}
