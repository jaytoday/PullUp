import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeGitHub } from "@pullup/github";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assessments, repos, runs } from "@/lib/db/schema";
import type { SyntheticPull } from "../../scripts/synthetic";
import { SYNTHETIC_CONFIG, SYNTHETIC_REPO } from "../../scripts/synthetic";
import { askwithaiClient } from "./decide/askwithai";
import { loadGitHub } from "./demo-github";
import { liveDeps, noteWorkflowFinished, type PipelineDeps, processRun } from "./pipeline";
import { getSetting, setSetting } from "./stores";

/**
 * Demo mode (`PULLUP_DEMO=1`): synthetic pull requests from
 * data/synthetic/pulls.jsonl go through the real pipeline on a fake GitHub
 * client, so every screen fills with real records without a GitHub App.
 * Everything here is synthetic and labeled so; outcomes come from the
 * generator's ground truth.
 */

export const isDemo = (env: Record<string, string | undefined> = process.env) => env.PULLUP_DEMO === "1";

const g = globalThis as unknown as { __pullupDemoGitHub?: FakeGitHub };
export function demoGitHub(): FakeGitHub {
  if (!g.__pullupDemoGitHub) {
    const gh = new FakeGitHub();
    gh.config.set(SYNTHETIC_REPO, JSON.stringify(SYNTHETIC_CONFIG));
    g.__pullupDemoGitHub = gh;
  }
  return g.__pullupDemoGitHub;
}

/** The dependencies the app runs with: the fake GitHub in demo mode, the real one otherwise. */
export function appDeps(): PipelineDeps {
  return isDemo() ? { ...liveDeps(), github: demoGitHub() } : liveDeps();
}

let pulls: SyntheticPull[] | null = null;
export function syntheticPulls(): SyntheticPull[] {
  if (pulls) return pulls;
  const file = join(process.cwd(), "data/synthetic/pulls.jsonl");
  pulls = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as SyntheticPull) : [];
  return pulls;
}

/** Play the next `size` synthetic pull requests through the pipeline: one split, or (by default) every pull request that is not a hard case. */
export async function playBatch(size = 20, deps: PipelineDeps = appDeps(), split?: SyntheticPull["split"]) {
  const all = syntheticPulls().filter((p) => (split ? p.split === split : p.split !== "hard"));
  const key = `demo:cursor:${split ?? "all"}`;
  const cursor = await getSetting<number>(key, 0);
  const batch = all.slice(cursor, cursor + size);
  await db.insert(repos).values({ fullName: SYNTHETIC_REPO, createdAt: deps.now(), synthetic: true }).onConflictDoNothing();
  const results: Record<string, number> = {};
  for (const p of batch) {
    loadGitHub(deps.github as FakeGitHub, p.run);
    const id = await noteWorkflowFinished(SYNTHETIC_REPO, p.run.headSha, p.run.pull.number, deps.now(), { synthetic: true });
    const state = await processRun(id, deps);
    results[state] = (results[state] ?? 0) + 1;
  }
  await setSetting(key, cursor + batch.length);
  return { played: batch.length, remaining: all.length - cursor - batch.length, results };
}

/**
 * Report what "really happened" for every decided synthetic run, from the
 * generator's ground truth: the outcome AskWithAI would get from a merge that
 * stayed (safe) or a revert (risky). Marked synthetic; idempotent.
 */
export async function reportDemoOutcomes(deps: PipelineDeps = appDeps()) {
  const client = askwithaiClient(deps.env, deps.fetch);
  if (!client) return { reported: 0, note: "AskWithAI is not configured." };
  const truth = new Map(syntheticPulls().map((p) => [p.run.headSha, p.truth]));
  let reported = 0;
  for (const r of await db.select().from(runs).where(eq(runs.synthetic, true))) {
    const t = truth.get(r.headSha);
    if (!t) continue;
    for (const a of await db.select().from(assessments).where(and(eq(assessments.runId, r.id), isNull(assessments.outcome)))) {
      const label = t[a.concern];
      if (!a.decisionId || !label) continue;
      await client.reportOutcome(a.decisionId, { labels: { merge_risk: label }, key: `pullup:synthetic:${r.id}:${a.concern}`, note: "Synthetic ground truth from PullUp's demo generator." });
      await db.update(assessments).set({ outcome: label, outcomeSource: "synthetic" }).where(and(eq(assessments.runId, r.id), eq(assessments.concern, a.concern)));
      reported++;
    }
  }
  return { reported };
}

/** Clear the demo's runs so it can start again (the demo repository only). */
export async function resetDemo() {
  const ids = (await db.select({ id: runs.id }).from(runs).where(eq(runs.synthetic, true))).map((r) => r.id);
  for (const id of ids) await db.delete(assessments).where(eq(assessments.runId, id));
  await db.delete(runs).where(eq(runs.synthetic, true));
  for (const split of ["all", "tune", "holdout", "hard"]) await setSetting(`demo:cursor:${split}`, 0);
  g.__pullupDemoGitHub = undefined;
  return { cleared: ids.length };
}
