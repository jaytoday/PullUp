import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assessments, runs } from "@/lib/db/schema";
import type { RunView } from "@/lib/view-types";

type Row = typeof runs.$inferSelect;
type ARow = typeof assessments.$inferSelect;

function view(r: Row, list: ARow[]): RunView {
  return {
    id: r.id, repo: r.repo, pull: r.pull, title: r.title, headSha: r.headSha, state: r.state, result: r.result ?? null, reason: r.reason, checkMode: r.checkMode,
    decider: r.decider, harness: r.harness, costUsd: r.costUsd, synthetic: r.synthetic, error: r.error, firstSeenAt: r.firstSeenAt.toISOString(),
    concerns: r.concerns, hardFailures: r.hardFailures, agentSteps: r.agentSteps, ci: r.ci, notes: r.notes,
    assessments: list.map((a) => ({ concern: a.concern, provider: a.provider, status: a.status, answer: a.answer, final: a.final, probability: a.probability, citations: a.citations, verified: a.verified, synthetic: a.synthetic, decisionId: a.decisionId, costUsd: a.costUsd, answeredBy: a.answeredBy, error: a.error })),
  };
}

export async function listRuns(limit = 200): Promise<RunView[]> {
  const rows = await db.select().from(runs).orderBy(desc(runs.firstSeenAt)).limit(limit);
  const list = rows.length ? await db.select().from(assessments).where(inArray(assessments.runId, rows.map((r) => r.id))) : [];
  return rows.map((r) => view(r, list.filter((a) => a.runId === r.id)));
}

export async function getRun(id: string): Promise<RunView | null> {
  const [r] = await db.select().from(runs).where(eq(runs.id, id));
  return r ? view(r, await db.select().from(assessments).where(eq(assessments.runId, id))) : null;
}

/** Counts for the quality page, from PullUp's own records. */
export async function runCounts() {
  const rows = await db.select({ result: runs.result, state: runs.state, synthetic: runs.synthetic }).from(runs);
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  return { total: rows.length, pass: count((r) => r.result === "pass"), fail: count((r) => r.result === "fail"), waiting: count((r) => r.result === "waiting"), errors: count((r) => r.state === "error"), synthetic: count((r) => r.synthetic) };
}
