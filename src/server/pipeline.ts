import { randomUUID } from "node:crypto";
import { appendEvidence, checkRunView, ciRunSchema, type Council, decideRun, parseConfig, type RunDecision, withaiCouncil } from "@pullup/engine";
import { collectRun, type GitHubApi, octokitApi, repoOctokit, sendCheckRun } from "@pullup/github";
import { WithAIClient } from "@withai/client";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { repos, runs } from "@/lib/db/schema";
import { evidenceStore, isStopped, nonceLedger } from "./stores";

/**
 * One commit, start to finish: read the config from the default branch,
 * collect CI once the required workflows finished, decide (hard failure →
 * fail, no trigger → pass, else the council and the resolution rule), record
 * the evidence, and post the "PullUp" check run through the governed sender.
 * In shadow mode the check is neutral with the would-be result in its text.
 */

export const CHECK_NAME = "PullUp";
/** How long to wait for every required workflow before deciding without the missing ones. */
export const COLLECT_WAIT_MS = 60 * 60_000;
const LOCK_MS = 5 * 60_000;

export interface PipelineDeps {
  github: GitHubApi;
  council: Council;
  now: () => Date;
}

export function liveDeps(): PipelineDeps {
  const baseUrl = process.env.WITHAI_URL?.trim();
  const token = process.env.WITHAI_TOKEN?.trim();
  let skillId: Promise<string> | undefined;
  const council: Council = async (question, run, seats) => {
    if (!baseUrl || !token) throw new Error("WithAI is not configured (WITHAI_URL, WITHAI_TOKEN)");
    const client = new WithAIClient({ baseUrl, token });
    skillId ??= process.env.PULLUP_SKILL_ID?.trim() ? Promise.resolve(process.env.PULLUP_SKILL_ID.trim()) : client.createSkill({ template: "ci-policy" }).then((r) => r.skill.id);
    skillId.catch(() => (skillId = undefined));
    return withaiCouncil({ client, skill: { id: await skillId } })(question, run, seats);
  };
  return { github: octokitApi((repo) => repoOctokit(repo)), council, now: () => new Date() };
}

/** A required workflow finished (or was rerun) for this commit: (re)open its run for collection. */
export async function noteWorkflowFinished(repo: string, headSha: string, pull: number | null, now: Date): Promise<string> {
  await db.insert(repos).values({ fullName: repo, createdAt: now }).onConflictDoNothing();
  const [row] = await db
    .insert(runs)
    .values({ id: randomUUID(), repo, headSha, pull, state: "collecting", mode: "shadow", firstSeenAt: now })
    .onConflictDoUpdate({ target: [runs.repo, runs.headSha], set: { state: "collecting", error: null } })
    .returning();
  if (pull !== null && row!.pull === null) await db.update(runs).set({ pull }).where(eq(runs.id, row!.id));
  return row!.id;
}

async function claim(runId: string, now: Date): Promise<boolean> {
  const got = await db
    .update(runs)
    .set({ lockedUntil: new Date(now.getTime() + LOCK_MS) })
    .where(and(eq(runs.id, runId), or(isNull(runs.lockedUntil), lt(runs.lockedUntil, now))))
    .returning();
  return got.length === 1;
}

const record = (repo: string, runId: string, kind: "collected" | "decided", payload: unknown, now: Date) =>
  appendEvidence(evidenceStore, { scope: repo, runId, kind, at: now.toISOString(), payload });

/** Process one run if no one else is. Returns the run's state afterwards. */
export async function processRun(runId: string, deps: PipelineDeps): Promise<string> {
  const now = deps.now();
  if (!(await claim(runId, now))) return "busy";
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) return "missing";
  try {
    const [repo] = await db.select().from(repos).where(eq(repos.fullName, run.repo));
    const mode = repo?.mode ?? "shadow";
    const rawConfig = await deps.github.defaultBranchConfig(run.repo);
    if (rawConfig === null) {
      await db.update(runs).set({ state: "error", error: "No .pullup/config.json on the default branch." }).where(eq(runs.id, runId));
      return "error";
    }
    const config = parseConfig(JSON.parse(rawConfig));
    const force = now.getTime() - run.firstSeenAt.getTime() >= COLLECT_WAIT_MS;
    const collected = await collectRun(deps.github, { repo: run.repo, headSha: run.headSha, pull: run.pull, config, force });
    if (collected.state === "waiting") {
      await db.update(runs).set({ pending: collected.pending }).where(eq(runs.id, runId));
      return "collecting";
    }
    await record(run.repo, runId, "collected", { jobs: collected.run.jobs.map((j) => ({ workflow: j.workflow, job: j.name, attempts: j.attempts.map((a) => a.conclusion) })), notes: collected.notes }, now);
    const decision: RunDecision = await decideRun(ciRunSchema.parse(collected.run), config, deps.council);
    await record(run.repo, runId, "decided", { result: decision.result, reason: decision.reason, questions: decision.questions.map((q) => ({ trigger: q.question.trigger, outcome: q.outcome, decidedBy: q.decidedBy })), councilCalls: decision.councilCalls, costUsd: decision.costUsd }, deps.now());
    const view = checkRunView(decision, mode, collected.notes);
    const sent = await sendCheckRun(
      { api: deps.github, permitKey: process.env.PULLUP_PERMIT_KEY?.trim() || null, ledger: nonceLedger, evidence: evidenceStore, stopped: isStopped, now: deps.now },
      runId,
      { repo: run.repo, headSha: run.headSha, name: CHECK_NAME, ...view, detailsUrl: process.env.PULLUP_URL ? `${process.env.PULLUP_URL.replace(/\/+$/, "")}/runs/${runId}` : undefined },
    );
    const state = decision.result === "waiting" ? "waiting" : "decided";
    await db
      .update(runs)
      .set({ state, result: decision.result, mode, decision, notes: collected.notes, pending: [], councilCalls: decision.councilCalls, costUsd: decision.costUsd, checkRun: sent, decidedAt: deps.now(), error: null })
      .where(eq(runs.id, runId));
    return state;
  } catch (err) {
    await db.update(runs).set({ state: "error", error: (err as Error).message }).where(eq(runs.id, runId));
    return "error";
  } finally {
    await db.update(runs).set({ lockedUntil: null }).where(eq(runs.id, runId));
  }
}

/** The worker's job: look again at runs still collecting (after an hour they are decided without what is missing). */
export async function processOpenRuns(deps: PipelineDeps): Promise<number> {
  const open = await db.select({ id: runs.id }).from(runs).where(eq(runs.state, "collecting"));
  for (const r of open) await processRun(r.id, deps);
  return open.length;
}
