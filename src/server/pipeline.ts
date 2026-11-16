import { randomUUID } from "node:crypto";
import {
  appendEvidence,
  type Assessment,
  type CheckMode,
  checkRunView,
  ciRunSchema,
  type Config,
  decideRun,
  detectConcerns,
  findHardFailures,
  type ParsedCiRun,
  parseConfig,
  verifiedQuotes,
} from "@pullup/engine";
import { collectRun, type GitHubApi, octokitApi, repoOctokit, sendCheckRun, sendRerun, type SenderDeps } from "@pullup/github";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assessments, repos, runs } from "@/lib/db/schema";
import { runAgent } from "./agent";
import { askMergeRisk, deciderOf, type ProviderAnswer } from "./decide";
import { askwithaiClient, fromDecision } from "./decide/askwithai";
import { matureOutcomes, reportPersonAnswer } from "./outcomes";
import { evidenceStore, isStopped, nonceLedger } from "./stores";

/**
 * One commit, start to finish. Read the config from the default branch,
 * collect CI once the required workflows finished, then:
 *   hard failure → fail (no model call); no concern → pass (no model call);
 *   otherwise the agent investigates and assesses each concern, and the
 *   fixed policy turns the typed answers into pass, fail or "wait for a person".
 * Every step goes on the tamper-evident record, and the "PullUp" check run is
 * posted through the governed sender.
 */

export const CHECK_NAME = "PullUp";
/** How long to wait for every required workflow before deciding without the missing ones. */
export const COLLECT_WAIT_MS = 60 * 60_000;
const LOCK_MS = 5 * 60_000;

export type Env = Record<string, string | undefined>;

export interface PipelineDeps {
  github: GitHubApi;
  env: Env;
  /** For tests and the demo: AskWithAI's faux server or a local AskWithAI. */
  fetch?: typeof fetch;
  now: () => Date;
}

export function liveDeps(): PipelineDeps {
  return { github: octokitApi((repo) => repoOctokit(repo)), env: process.env, now: () => new Date() };
}

export function senderDeps(deps: PipelineDeps): SenderDeps {
  return { api: deps.github, permitKey: deps.env.PULLUP_PERMIT_KEY?.trim() || null, ledger: nonceLedger, evidence: evidenceStore, stopped: isStopped, now: deps.now };
}

const record = (repo: string, runId: string, kind: "collected" | "decided" | "assessed" | "answered" | "outcome", payload: unknown, now: Date) =>
  appendEvidence(evidenceStore, { scope: repo, runId, kind, at: now.toISOString(), payload });

/** A required workflow finished (or was rerun) for this commit: (re)open its run for collection. */
export async function noteWorkflowFinished(repo: string, headSha: string, pull: number | null, now: Date, opts: { synthetic?: boolean } = {}): Promise<string> {
  await db.insert(repos).values({ fullName: repo, createdAt: now, synthetic: opts.synthetic ?? false }).onConflictDoNothing();
  const [row] = await db
    .insert(runs)
    .values({ id: randomUUID(), repo, headSha, pull, state: "collecting", firstSeenAt: now, synthetic: opts.synthetic ?? false })
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

export async function repoMode(repo: string): Promise<CheckMode> {
  const [r] = await db.select().from(repos).where(eq(repos.fullName, repo));
  return r?.checkMode ?? "report_only";
}

function toRow(runId: string, concern: Assessment["concern"], a: ProviderAnswer, run: ParsedCiRun, now: Date) {
  return {
    runId,
    concern,
    provider: a.provider,
    status: a.status,
    answer: a.answer,
    final: a.final,
    probability: a.probability,
    citations: a.citations,
    verified: verifiedQuotes(a.citations, run),
    synthetic: a.synthetic,
    decisionId: a.decisionId,
    costUsd: a.costUsd,
    answeredBy: a.answeredBy,
    error: a.error,
    inputRequest: a.inputRequest ?? null,
    updatedAt: now,
  };
}

/** Process one run if no one else is. Returns the run's state afterwards. */
export async function processRun(runId: string, deps: PipelineDeps): Promise<string> {
  const now = deps.now();
  if (!(await claim(runId, now))) return "busy";
  const [row] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!row) return "missing";
  try {
    const rawConfig = await deps.github.defaultBranchConfig(row.repo);
    if (rawConfig === null) {
      await db.update(runs).set({ state: "error", error: "No .pullup/config.json on the default branch." }).where(eq(runs.id, runId));
      return "error";
    }
    const config = parseConfig(JSON.parse(rawConfig));
    const force = now.getTime() - row.firstSeenAt.getTime() >= COLLECT_WAIT_MS;
    const collected = await collectRun(deps.github, { repo: row.repo, headSha: row.headSha, pull: row.pull, config, force });
    if (collected.state === "waiting") return "collecting";
    const run = ciRunSchema.parse(collected.run);
    const ci = run.jobs.map((j) => ({ workflow: j.workflow, job: j.name, attempts: j.attempts.map((a) => a.conclusion) }));
    await record(row.repo, runId, "collected", { jobs: ci, notes: collected.notes }, now);

    const hardFailures = findHardFailures(run, config);
    const concerns = hardFailures.length ? [] : detectConcerns(run, config);
    const mode = await repoMode(row.repo);
    let rerunRequested = false;
    const result = concerns.length
      ? await runAgent(
          {
            run,
            config,
            concerns,
            hardFailures,
            assess: (c, input) => askMergeRisk(input, { traceId: row.headSha, requestId: `pullup:${runId}:${c.concern}`, env: deps.env, fetch: deps.fetch }),
            answerInput: async (decisionId, field, value, expectedVersion) => {
              const client = askwithaiClient(deps.env, deps.fetch);
              if (!client) throw new Error("AskWithAI is not configured");
              return fromDecision(await client.answerInput(decisionId, { field, value, expectedVersion }));
            },
            readFile: async (path) => (await deps.github.readFiles(row.repo, { sha: row.headSha }, [path]))[0]?.text ?? null,
            rerun: row.rerunRequested
              ? undefined
              : async (workflow) => {
                  const ids = collected.rerunnable;
                  for (const id of ids) await sendRerun(senderDeps(deps), runId, { repo: row.repo, workflowRunId: id });
                  rerunRequested = ids.length > 0;
                  return ids.length ? `Rerun requested for ${workflow}.` : "Nothing to rerun.";
                },
          },
          deps.env,
        )
      : null;

    if (rerunRequested) {
      // A new attempt is coming: decide again once it finishes.
      await db.update(runs).set({ rerunRequested: true, state: "collecting", agentSteps: result?.steps ?? [] }).where(eq(runs.id, runId));
      return "collecting";
    }
    await db.delete(assessments).where(eq(assessments.runId, runId));
    for (const c of concerns) await db.insert(assessments).values(toRow(runId, c.concern, result!.answers.get(c.concern)!, run, now));
    const answers = [...(result?.answers.values() ?? [])];
    const cost = answers.some((a) => a.costUsd === null && a.provider === "askwithai") ? null : answers.reduce((s, a) => s + (a.costUsd ?? 0), 0);
    await record(row.repo, runId, "assessed", { hardFailures, concerns: concerns.map((c) => c.concern), harness: result?.harness ?? null, answers: answers.map((a) => ({ provider: a.provider, status: a.status, answer: a.answer, decisionId: a.decisionId, synthetic: a.synthetic })) }, deps.now());
    await db
      .update(runs)
      .set({
        title: run.pull?.title ?? "",
        checkMode: mode,
        decider: concerns.length ? deciderOf(deps.env) : null,
        harness: result?.harness ?? null,
        hardFailures,
        concerns,
        agentSteps: result?.steps.map((s) => ({ tool: s.tool, summary: s.summary, at: s.at })) ?? [],
        ci,
        config,
        notes: [...collected.notes, ...(result?.error ? [`The agent stopped early: ${result.error}`] : [])],
        costUsd: cost,
        synthetic: row.synthetic || answers.some((a) => a.synthetic),
        error: null,
      })
      .where(eq(runs.id, runId));
    return await finishRun(runId, deps);
  } catch (err) {
    await db.update(runs).set({ state: "error", error: (err as Error).message }).where(eq(runs.id, runId));
    return "error";
  } finally {
    await db.update(runs).set({ lockedUntil: null }).where(eq(runs.id, runId));
  }
}

export async function loadAssessments(runId: string): Promise<Assessment[]> {
  const rows = await db.select().from(assessments).where(eq(assessments.runId, runId));
  return rows.map((r) => ({ concern: r.concern, provider: r.provider, status: r.status, answer: r.answer, final: r.final, probability: r.probability, citations: r.citations, verified: r.verified, synthetic: r.synthetic, decisionId: r.decisionId, costUsd: r.costUsd, answeredBy: r.answeredBy, error: r.error }));
}

/**
 * Apply the fixed policy to the run's assessments and post the check run.
 * Called after deciding, and again whenever an answer changes something.
 */
export async function finishRun(runId: string, deps: PipelineDeps): Promise<string> {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!row) return "missing";
  const list = await loadAssessments(runId);
  const decision = decideRun(row.hardFailures, list, row.checkMode);
  const view = checkRunView(decision, list, row.checkMode, row.notes);
  const waiting = row.checkMode === "enforce" && decision.result === "waiting";
  const sent = await sendCheckRun(senderDeps(deps), runId, {
    repo: row.repo,
    headSha: row.headSha,
    name: CHECK_NAME,
    ...view,
    ...(waiting
      ? {
          actions: [
            { label: "Pass", identifier: "pass", description: "Pass this run (reviewers or admins)" },
            { label: "Fail", identifier: "fail", description: "Fail this run (reviewers or admins)" },
          ],
        }
      : {}),
    detailsUrl: deps.env.PULLUP_URL ? `${deps.env.PULLUP_URL.replace(/\/+$/, "")}/runs/${runId}` : undefined,
  });
  await record(row.repo, runId, "decided", { result: decision.result, reason: decision.reason, concerns: decision.concerns }, deps.now());
  const state = decision.result === "waiting" ? "waiting" : "decided";
  await db.update(runs).set({ state, result: decision.result, reason: decision.reason, checkRun: sent, decidedAt: deps.now() }).where(eq(runs.id, runId));
  return state;
}

/**
 * Waiting runs: read each open AskWithAI decision again (a person may have
 * answered in AskWithAI, or a deadline passed), and settle the run when
 * something changed.
 */
export async function refreshWaiting(deps: PipelineDeps): Promise<number> {
  const client = askwithaiClient(deps.env, deps.fetch);
  if (!client) return 0;
  let changed = 0;
  for (const row of await db.select().from(runs).where(eq(runs.state, "waiting"))) {
    let touched = false;
    for (const a of await db.select().from(assessments).where(and(eq(assessments.runId, row.id), eq(assessments.final, false)))) {
      if (!a.decisionId) continue;
      const fresh = fromDecision(await client.getDecision(a.decisionId));
      if (fresh.status === a.status && fresh.answer === a.answer && fresh.final === a.final) continue;
      const run = ciRunSchema.parse({ repo: row.repo, headSha: row.headSha, jobs: [], diff: "" });
      // Keep the quotes PullUp checked when it decided; a person's answer needs none.
      const updated = { ...toRow(row.id, a.concern, fresh, run, deps.now()), verified: fresh.answer === a.answer ? a.verified : [] };
      await db.update(assessments).set(updated).where(and(eq(assessments.runId, row.id), eq(assessments.concern, a.concern)));
      touched = true;
    }
    if (touched) {
      await finishRun(row.id, deps);
      changed++;
    }
  }
  return changed;
}

export type PersonAnswer = "pass" | "fail";

/** `/pullup pass <reason>` or `/pullup fail <reason>` in a pull request comment. */
export function parsePullupCommand(body: string): { value: PersonAnswer; reason: string } | null {
  const m = /^\s*\/pullup\s+(pass|fail)\b[ \t]*(.*)/i.exec(body);
  return m ? { value: m[1]!.toLowerCase() as PersonAnswer, reason: m[2]!.trim() } : null;
}

export async function latestRunForPull(repo: string, pull: number) {
  const [row] = (await db.select().from(runs).where(and(eq(runs.repo, repo), eq(runs.pull, pull)))).sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime());
  return row ?? null;
}

/**
 * A Pass or Fail button on the check, or a `/pullup` comment, from GitHub
 * user `login`. Only the repository's listed reviewers or its admins count.
 * Each open AskWithAI review on the run is settled with the person's label
 * (fail means risky, pass means safe); assessments without an AskWithAI
 * review (a baseline provider, a failed call) take the answer directly.
 */
export async function answerFromGithub(runId: string, login: string, value: PersonAnswer, reason: string, via: string, deps: PipelineDeps): Promise<{ accepted: boolean; why: string }> {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!row) return { accepted: false, why: "No such run." };
  if (row.state !== "waiting") return { accepted: false, why: "This run is not waiting for a person." };
  const config = parseConfig(row.config ?? { requiredWorkflows: ["ci"] }) as Config;
  const allowed = config.reviewers.includes(login) || (await deps.github.permission(row.repo, login)) === "admin";
  if (!allowed) return { accepted: false, why: `${login} is not a reviewer of ${row.repo}.` };
  const label = value === "fail" ? "risky" : "safe";
  const client = askwithaiClient(deps.env, deps.fetch);
  const pending = client ? (await client.listReviews("pending")).data : [];
  const now = deps.now();
  let answeredDirectly = false;
  for (const a of await db.select().from(assessments).where(and(eq(assessments.runId, row.id), eq(assessments.final, false)))) {
    const review = a.decisionId ? pending.find((r) => r.decisionId === a.decisionId && r.requestKind !== "input") : undefined;
    if (client && review) {
      await client.settleReview(review.id, { decision: label, reason: `${reason || "No reason given"} (GitHub ${via} by ${login})`, expectedVersion: review.version });
      const fresh = fromDecision(await client.getDecision(a.decisionId!));
      await db.update(assessments).set({ status: fresh.status, answer: fresh.answer, final: fresh.final, answeredBy: `person:${login}`, synthetic: false, verified: [], updatedAt: now }).where(and(eq(assessments.runId, row.id), eq(assessments.concern, a.concern)));
    } else {
      await db.update(assessments).set({ status: "decided", answer: label, final: true, answeredBy: `person:${login}`, synthetic: false, error: null, verified: [], updatedAt: now }).where(and(eq(assessments.runId, row.id), eq(assessments.concern, a.concern)));
      answeredDirectly = true;
    }
  }
  // Answers AskWithAI did not see as a review still teach it: report them as outcomes.
  if (answeredDirectly) await reportPersonAnswer(deps, row.id, label);
  await record(row.repo, row.id, "answered", { by: login, via, value, reason }, now);
  await finishRun(row.id, deps);
  return { accepted: true, why: `Recorded ${value} from ${login}.` };
}

/** The worker's minute: runs still collecting, then waiting runs whose decisions may have moved, then outcomes that are due. */
export async function processOpenRuns(deps: PipelineDeps): Promise<number> {
  const open = await db.select({ id: runs.id }).from(runs).where(eq(runs.state, "collecting"));
  for (const r of open) await processRun(r.id, deps);
  await refreshWaiting(deps).catch((e: Error) => console.error("pullup: refreshing waiting runs:", e.message));
  await matureOutcomes(deps).catch((e: Error) => console.error("pullup: reporting outcomes:", e.message));
  return open.length;
}
