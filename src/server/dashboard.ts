import type { AskState, Config, ResolvedQuestion, RunDecision } from "@pullup/engine";
import { storedConfig, storedDecision, verifyChain } from "@pullup/engine";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { asks, repos, runs } from "@/lib/db/schema";
import { evidenceChain, evidenceFor, isStopped } from "./stores";

/** Read-only views of PullUp's records for the dashboard pages. */

export type RunRow = typeof runs.$inferSelect;
const DAY = 86_400_000;

export const decisionOf = (run: RunRow): RunDecision | null => (run.decision ? storedDecision(run.decision) : null);
export const configOf = (run: RunRow): Config | null => (run.config ? storedConfig(run.config) : null);

/** Who settled the run: a hard failure, nothing tricky, the council, a person, or a no-answer option. */
export function decidedBy(run: RunRow, runAsks: Record<string, AskState>): string {
  const d = decisionOf(run);
  if (!d) return run.state === "error" ? "error" : "collecting";
  if (d.hardFailures.length) return "hard failure";
  if (!d.questions.length) return "nothing tricky";
  const states = Object.values(runAsks);
  if (states.some((s) => s.answer)) return "a person";
  if (states.some((s) => s.noAnswer)) return `no answer (${states.find((s) => s.noAnswer)!.noAnswer!.option})`;
  if (run.result === "waiting") return run.mode === "active" ? "waiting for a person" : "would ask a person";
  return "the council";
}

export async function overview(now = new Date()) {
  const since = new Date(now.getTime() - DAY);
  const today = await db.select().from(runs).where(gte(runs.firstSeenAt, since));
  const decided = today.filter((r) => r.decision);
  const council = decided.filter((r) => r.councilCalls > 0);
  const recent = await db.select().from(runs).orderBy(desc(runs.firstSeenAt)).limit(12);
  const waiting = await db.select().from(runs).where(eq(runs.state, "waiting"));
  // Repositories where the council (not a person or a rule) has passed a run.
  const councilPasses = (await db.select().from(runs).where(eq(runs.result, "pass")))
    .filter((r) => r.mode === "active" && decisionOf(r)?.questions.some((q) => q.decidedBy === "council" && q.outcome === "pass"))
    .map((r) => r.repo);
  return {
    councilPassRepos: [...new Set(councilPasses)],
    runsToday: today.length,
    councilShare: decided.length ? council.length / decided.length : 0,
    costToday: today.reduce((s, r) => s + r.costUsd, 0),
    waiting: waiting.length,
    recent,
    repoCount: (await db.select().from(repos)).length,
    stopped: await isStopped(),
  };
}

export async function listRuns(filter: { repo?: string; pull?: number } = {}) {
  const where = [filter.repo ? eq(runs.repo, filter.repo) : undefined, filter.pull ? eq(runs.pull, filter.pull) : undefined].filter((x) => x !== undefined);
  return db.select().from(runs).where(where.length ? and(...where) : undefined).orderBy(desc(runs.firstSeenAt)).limit(200);
}

export async function runDetail(id: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) return null;
  const runAsks = Object.fromEntries((await db.select().from(asks).where(eq(asks.runId, id))).map((a) => [a.questionId, { state: a.state as AskState, withai: a.withai }]));
  const rows = await evidenceFor(id);
  const chain = verifyChain(await evidenceChain(run.repo));
  return { run, asks: runAsks, evidence: rows, chainOk: chain.ok };
}

/** Questions waiting for a person right now (active mode). */
export async function openQuestions() {
  const open = await db.select().from(asks).where(eq(asks.open, true));
  const result: { run: RunRow; question: ResolvedQuestion; state: AskState }[] = [];
  for (const a of open) {
    const [run] = await db.select().from(runs).where(eq(runs.id, a.runId));
    const question = run && decisionOf(run)?.questions.find((q) => q.question.id === a.questionId);
    if (run && question) result.push({ run, question, state: a.state as AskState });
  }
  return result;
}

/** Council cost per day for the last `days` days, oldest first. */
export async function costPerDay(days = 14, now = new Date()) {
  const start = new Date(now.getTime() - days * DAY);
  const rows = await db.select({ at: runs.firstSeenAt, cost: runs.costUsd, calls: runs.councilCalls }).from(runs).where(gte(runs.firstSeenAt, start));
  const byDay = new Map<string, { cost: number; calls: number; runs: number }>();
  for (let i = days - 1; i >= 0; i--) byDay.set(new Date(now.getTime() - i * DAY).toISOString().slice(0, 10), { cost: 0, calls: 0, runs: 0 });
  for (const r of rows) {
    const d = byDay.get(r.at.toISOString().slice(0, 10));
    if (d) {
      d.cost += r.cost;
      d.calls += r.calls;
      d.runs += 1;
    }
  }
  return [...byDay].map(([day, v]) => ({ day, ...v }));
}

/**
 * Per question kind (`core:flaky-test`, `threat-model:T3`): of the questions a
 * person answered, how often the council's lean (most seats "pass" and no
 * valid "fail" → pass, else fail) matched them. `extension` narrows it to one extension.
 */
export async function questionAccuracy(extension?: string) {
  const answered = (await db.select().from(asks)).filter((a) => (a.state as AskState).answer && (!extension || a.questionId.startsWith(`${extension}:`)));
  const byTrigger = new Map<string, { agreed: number; total: number }>();
  for (const a of answered) {
    const [run] = await db.select().from(runs).where(eq(runs.id, a.runId));
    const q = run && decisionOf(run)?.questions.find((x) => x.question.id === a.questionId);
    if (!q) continue;
    const passes = q.seats.filter((s) => s.verdict === "pass").length;
    const lean = passes * 2 > q.seats.length && !q.seats.some((s) => s.verdict === "fail" && s.validQuotes.length) ? "pass" : "fail";
    const t = byTrigger.get(q.question.id) ?? { agreed: 0, total: 0 };
    t.total += 1;
    if (lean === (a.state as AskState).answer!.value) t.agreed += 1;
    byTrigger.set(q.question.id, t);
  }
  return [...byTrigger].map(([id, v]) => ({ id, ...v }));
}

export async function repoList() {
  const all = await db.select().from(repos).orderBy(repos.fullName);
  const latest = await Promise.all(all.map(async (r) => (await db.select().from(runs).where(eq(runs.repo, r.fullName)).orderBy(desc(runs.firstSeenAt)).limit(1))[0] ?? null));
  return all.map((r, i) => ({ ...r, latest: latest[i] }));
}
