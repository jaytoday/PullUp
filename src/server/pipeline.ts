import { randomUUID } from "node:crypto";
import { appendEvidence, checkRunView, ciRunSchema, combine, type Council, decideRun, parseConfig, type RunDecision, settle, storedDecision, withaiCouncil } from "@pullup/engine";
import { collectRun, type GitHubApi, octokitApi, repoOctokit, sendCheckRun, sendRerun, type SenderDeps } from "@pullup/github";
import { WithAIClient } from "@withai/client";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { asks, repos, runs } from "@/lib/db/schema";
import { type AskClient, type AskDeps, ensureAsks, loadAsks, recordAnswer, recordGithubAnswer, tickAsks } from "./asking";
import { evidenceStore, isStopped, nonceLedger } from "./stores";

/**
 * One commit, start to finish: read the config from the default branch,
 * collect CI once the required workflows finished, decide (hard failure →
 * fail, no trigger → pass, else the council and the resolution rule), record
 * the evidence, and post the "PullUp" check run through the governed sender.
 * In shadow mode the check is neutral with the would-be result in its text.
 * In active mode it passes or fails, and a question that needs a person is
 * asked (see asking.ts); the check stays in progress until it is settled.
 */

export const CHECK_NAME = "PullUp";
/** How long to wait for every required workflow before deciding without the missing ones. */
export const COLLECT_WAIT_MS = 60 * 60_000;
const LOCK_MS = 5 * 60_000;

export interface PipelineDeps {
  github: GitHubApi;
  council: Council;
  /** WithAI's ask-a-person calls; null when WithAI is not configured. */
  withai: AskClient | null;
  now: () => Date;
}

function withaiClient(): WithAIClient | null {
  const baseUrl = process.env.WITHAI_URL?.trim();
  const token = process.env.WITHAI_TOKEN?.trim();
  return baseUrl && token ? new WithAIClient({ baseUrl, token }) : null;
}

let skillId: Promise<string> | undefined;
/** The workspace's CI policy skill: `PULLUP_SKILL_ID`, or created once from WithAI's template. */
function ciPolicySkill(client: WithAIClient): Promise<string> {
  const fixed = process.env.PULLUP_SKILL_ID?.trim();
  if (fixed) return Promise.resolve(fixed);
  skillId ??= client.createSkill({ template: "ci-policy" }).then((r) => r.skill.id);
  skillId.catch(() => (skillId = undefined));
  return skillId;
}

export function liveDeps(): PipelineDeps {
  const client = withaiClient();
  const council: Council = async (question, run, seats) => {
    if (!client) throw new Error("WithAI is not configured (WITHAI_URL, WITHAI_TOKEN)");
    return withaiCouncil({ client, skill: { id: await ciPolicySkill(client) } })(question, run, seats);
  };
  return { github: octokitApi((repo) => repoOctokit(repo)), council, withai: client, now: () => new Date() };
}

export function senderDeps(deps: PipelineDeps): SenderDeps {
  return { api: deps.github, permitKey: process.env.PULLUP_PERMIT_KEY?.trim() || null, ledger: nonceLedger, evidence: evidenceStore, stopped: isStopped, now: deps.now };
}

export function askDeps(deps: PipelineDeps): AskDeps {
  const client = deps.withai;
  return {
    withai: client,
    sender: senderDeps(deps),
    skillId: async () => (client instanceof WithAIClient ? ciPolicySkill(client).catch(() => null) : (process.env.PULLUP_SKILL_ID?.trim() ?? null)),
    now: deps.now,
  };
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
    // The flaky-test rule's one rerun (off unless the repo turns it on): ask GitHub, then wait for the new attempt.
    if (config.flaky.rerun && !run.rerunRequested && collected.rerunnable.length) {
      for (const workflowRunId of collected.rerunnable) await sendRerun(senderDeps(deps), runId, { repo: run.repo, workflowRunId });
      await db.update(runs).set({ rerunRequested: true, pending: ["rerun of failed jobs"] }).where(eq(runs.id, runId));
      return "collecting";
    }
    await record(run.repo, runId, "collected", { jobs: collected.run.jobs.map((j) => ({ workflow: j.workflow, job: j.name, attempts: j.attempts.map((a) => a.conclusion) })), notes: collected.notes }, now);
    const decision: RunDecision = await decideRun(ciRunSchema.parse(collected.run), config, deps.council, { now: now.getTime() });
    await record(run.repo, runId, "decided", { result: decision.result, reason: decision.reason, questions: decision.questions.map((q) => ({ id: q.question.id, shadow: q.question.shadow, outcome: q.outcome, decidedBy: q.decidedBy })), councilCalls: decision.councilCalls, costUsd: decision.costUsd, extensions: decision.extensions && { compositionHash: decision.extensions.compositionHash, outputs: decision.extensions.outputs, relaxations: decision.extensions.relaxations } }, deps.now());
    await db
      .update(runs)
      .set({ mode, decision, config, notes: collected.notes, pending: [], councilCalls: decision.councilCalls, costUsd: decision.costUsd, error: null })
      .where(eq(runs.id, runId));
    const [stored] = await db.select().from(runs).where(eq(runs.id, runId));
    if (mode === "active") await ensureAsks(stored!, askDeps(deps));
    return await finishRun(runId, deps);
  } catch (err) {
    await db.update(runs).set({ state: "error", error: (err as Error).message }).where(eq(runs.id, runId));
    return "error";
  } finally {
    await db.update(runs).set({ lockedUntil: null }).where(eq(runs.id, runId));
  }
}

/**
 * Settle the run's questions with the asks (a person's answer or the no-answer
 * outcome), combine them into the run's result, and post the check run.
 * Called after deciding, and again whenever an answer or a deadline changes something.
 */
export async function finishRun(runId: string, deps: PipelineDeps): Promise<string> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run?.decision) return "missing";
  const decision = storedDecision(run.decision);
  const questions = settle(decision.questions, await loadAsks(runId));
  const settled: RunDecision = decision.hardFailures.length ? decision : { ...decision, ...combine(questions), questions };
  const view = checkRunView(settled, run.mode, run.notes);
  const waitingFor = questions.find((q) => q.outcome === "ask" && !q.question.shadow);
  const active = run.mode === "active" && settled.result === "waiting";
  const sent = await sendCheckRun(senderDeps(deps), runId, {
    repo: run.repo,
    headSha: run.headSha,
    name: CHECK_NAME,
    ...view,
    ...(active && waitingFor
      ? {
          title: `${waitingFor.reason.replace(/\.$/, "")}: ${waitingFor.question.prompt}`.slice(0, 200),
          actions: [
            { label: "Pass", identifier: "pass", description: "Pass this run (people asked or admins)" },
            { label: "Fail", identifier: "fail", description: "Fail this run (people asked or admins)" },
          ],
        }
      : {}),
    detailsUrl: process.env.PULLUP_URL ? `${process.env.PULLUP_URL.replace(/\/+$/, "")}/runs/${runId}` : undefined,
  });
  const state = settled.result === "waiting" ? "waiting" : "decided";
  await db.update(runs).set({ state, result: settled.result, reason: settled.reason, checkRun: sent, decidedAt: deps.now() }).where(eq(runs.id, runId));
  return state;
}

/** The worker's minute: runs still collecting (decided without what is missing after an hour), then the asks' clocks and WithAI answers. */
export async function processOpenRuns(deps: PipelineDeps): Promise<number> {
  const open = await db.select({ id: runs.id }).from(runs).where(eq(runs.state, "collecting"));
  for (const r of open) await processRun(r.id, deps);
  for (const runId of await tickAsks(askDeps(deps))) await finishRun(runId, deps);
  return open.length;
}

/** A Pass / Fail button or a `/pullup` comment from GitHub user `login`. */
export async function answerFromGithub(run: typeof runs.$inferSelect, login: string, value: "pass" | "fail", reason: string, via: string, deps: PipelineDeps) {
  const result = await recordGithubAnswer(run, login, value, reason, via, { ...askDeps(deps), permission: deps.github.permission.bind(deps.github) });
  if (result.accepted) await finishRun(run.id, deps);
  return result;
}

/** An answer through WithAI: it counts as from the person that question was sent to. */
export async function answerFromWithai(withaiQuestionId: string, value: "pass" | "fail", reason: string, deps: PipelineDeps) {
  const row = (await db.select().from(asks).where(eq(asks.open, true))).find((a) => a.withai.some((w) => w.id === withaiQuestionId));
  const [run] = row ? await db.select().from(runs).where(eq(runs.id, row.runId)) : [];
  if (!row || !run) return { accepted: 0, why: "No open PullUp question has this WithAI question." };
  const to = row.withai.find((w) => w.id === withaiQuestionId)!.to;
  const result = await recordAnswer(run, { value, by: to, isAdmin: false, reason, via: "withai", questionId: row.questionId }, askDeps(deps));
  if (result.accepted) await finishRun(run.id, deps);
  return result;
}
