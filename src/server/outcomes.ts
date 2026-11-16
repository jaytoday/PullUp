import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assessments, runs } from "@/lib/db/schema";
import { askwithaiClient } from "./decide/askwithai";
import type { PipelineDeps } from "./pipeline";
import { evidenceStore } from "./stores";
import { appendEvidence } from "@pullup/engine";

/**
 * What really happened, reported to AskWithAI so it can measure and improve
 * the runtime:
 * - a pull request merged and not reverted within 7 days: `safe`;
 * - a merged pull request that was reverted: `risky`;
 * - a person's answer in GitHub on a decision that had no AskWithAI review: their label.
 * Each report has an idempotency key, so a repeat is counted once. Only
 * decisions with an AskWithAI decision id can be reported.
 */

export const SAFE_AFTER_MS = 7 * 86_400_000;

async function report(deps: PipelineDeps, runId: string, label: "risky" | "safe", source: string): Promise<number> {
  const client = askwithaiClient(deps.env, deps.fetch);
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!client || !run) return 0;
  let n = 0;
  for (const a of await db.select().from(assessments).where(and(eq(assessments.runId, runId), isNotNull(assessments.decisionId), isNull(assessments.outcome)))) {
    await client.reportOutcome(a.decisionId!, { labels: { merge_risk: label }, key: `pullup:${source}:${runId}:${a.concern}` });
    await db.update(assessments).set({ outcome: label, outcomeSource: source }).where(and(eq(assessments.runId, runId), eq(assessments.concern, a.concern)));
    n++;
  }
  if (n) await appendEvidence(evidenceStore, { scope: run.repo, runId, kind: "outcome", at: deps.now().toISOString(), payload: { label, source, decisions: n } });
  return n;
}

/** A pull request merged. */
export async function noteMerged(repo: string, pull: number, at: Date) {
  await db.update(runs).set({ mergedAt: at }).where(and(eq(runs.repo, repo), eq(runs.pull, pull), isNull(runs.mergedAt)));
}

/** A merged revert pull request named the original one ("Reverts owner/repo#123"): every decision on it was risky. */
export async function noteReverted(repo: string, pull: number, at: Date, deps: PipelineDeps): Promise<number> {
  let n = 0;
  for (const r of await db.select().from(runs).where(and(eq(runs.repo, repo), eq(runs.pull, pull)))) {
    await db.update(runs).set({ revertedAt: at }).where(eq(runs.id, r.id));
    n += await report(deps, r.id, "risky", "revert");
  }
  return n;
}

/** GitHub's revert pull request says "Reverts owner/repo#123" in its body. */
export function revertedPull(body: string, repo: string): number | null {
  const m = new RegExp(`Reverts ${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#(\\d+)`).exec(body);
  return m ? Number(m[1]) : null;
}

/** A person answered in GitHub on a decision with no AskWithAI review: their answer is the outcome. */
export function reportPersonAnswer(deps: PipelineDeps, runId: string, label: "risky" | "safe") {
  return report(deps, runId, label, "person");
}

/** Merged at least 7 days ago and never reverted: safe. */
export async function matureOutcomes(deps: PipelineDeps): Promise<number> {
  const due = await db
    .select()
    .from(runs)
    .where(and(isNotNull(runs.mergedAt), isNull(runs.revertedAt), lte(runs.mergedAt, new Date(deps.now().getTime() - SAFE_AFTER_MS))));
  let n = 0;
  for (const r of due) n += await report(deps, r.id, "safe", "merged");
  return n;
}
