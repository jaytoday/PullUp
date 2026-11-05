/**
 * Fill the development database with realistic runs, made by the real
 * pipeline from the fixtures with recorded council answers and a fake GitHub
 * (nothing leaves this machine). Also creates the owner account.
 *
 *   pnpm seed            (uses .data/pullup.db, or PULLUP_DB_FILE)
 */
import { readFileSync } from "node:fs";
import { configInput, loadFixtures, type Recording, replayCouncil } from "@pullup/engine";
import { FakeGitHub } from "@pullup/github";
import { db, migrateDb } from "@/lib/db/client";
import { asks, deliveries, evidence, permitNonces, repos, runs, settings } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { answerFromGithub, noteWorkflowFinished, processOpenRuns, processRun } from "@/server/pipeline";
import { eq } from "drizzle-orm";

process.env.PULLUP_PERMIT_KEY ||= "dev-permit-key";
await migrateDb();
for (const t of [asks, runs, evidence, deliveries, permitNonces, settings, repos]) await db.delete(t);

const fixtures = loadFixtures("fixtures");
// Recorded live council answers per fixture, keyed by the fixture's 7-character commit id (seeded runs add the pull number).
const councilFor = (fixture: string) => {
  let recording: Recording = {};
  try {
    recording = JSON.parse(readFileSync(`fixtures/recorded/${fixture}.json`, "utf8")) as Recording;
  } catch {
    // No recording: its questions go to a person.
  }
  const replay = replayCouncil(recording);
  return ((q, run, seats) => replay(q, { ...run, headSha: run.headSha.slice(0, 7) }, seats)) as typeof replay;
};
const HOUR = 3_600_000;
const start = Date.now() - 20 * HOUR;
// `shadow`: extensions to switch to Shadow mode for that run, to show the "would ask" group.
const plan: { fixture: string; repo: string; mode: "shadow" | "active"; pull: number; shadow?: string[] }[] = [
  { fixture: "clean-pass", repo: "acme/shop", mode: "active", pull: 41 },
  { fixture: "hard-fail-repeat", repo: "acme/shop", mode: "active", pull: 42 },
  { fixture: "weakened-skip", repo: "acme/shop", mode: "active", pull: 43 },
  { fixture: "sensitive-auth", repo: "acme/shop", mode: "active", pull: 44 },
  { fixture: "flaky-and-sensitive", repo: "acme/shop", mode: "active", pull: 45 },
  { fixture: "weakened-assertions", repo: "acme/docs", mode: "shadow", pull: 7 },
  { fixture: "flaky-rerun-pass", repo: "acme/docs", mode: "shadow", pull: 8 },
  { fixture: "snapshot-rewrite", repo: "acme/docs", mode: "shadow", pull: 9 },
  { fixture: "tests-added-only", repo: "acme/docs", mode: "shadow", pull: 10 },
  { fixture: "threat-control-touched", repo: "acme/payments", mode: "active", pull: 3 },
  { fixture: "threat-new-route", repo: "acme/payments", mode: "active", pull: 4, shadow: ["threat-model"] },
];
for (const repo of new Set(plan.map((p) => p.repo))) await db.insert(repos).values({ fullName: repo, mode: plan.find((p) => p.repo === repo)!.mode, createdAt: new Date(start) });

let i = 0;
const runIds: Record<string, string> = {};
for (const p of plan) {
  const f = fixtures.find((x) => x.name === p.fixture)!;
  const gh = new FakeGitHub();
  // Fixtures share commit ids; each seeded run gets its own.
  f.run.headSha = `${f.run.headSha}${p.pull}`;
  const file = configInput(f.config);
  for (const id of p.shadow ?? []) file.extensions[id] = { ...file.extensions[id], mode: "shadow" };
  gh.config.set(p.repo, JSON.stringify({ ...file, ask: { ...file.ask, to: "reviewer@example.com", toGithub: "jaytoday-test", deadlineMinutes: 240 } }));
  gh.files.set(p.repo, Object.fromEntries(f.run.files.filter((x) => x.from === "default").map((x) => [x.path, x.text])));
  gh.files.set(`${p.repo}@${f.run.headSha}`, Object.fromEntries(f.run.files.filter((x) => x.from === "head").map((x) => [x.path, x.text])));
  // Each fixture job becomes one workflow run with its attempts.
  const byWorkflow = new Map<string, typeof f.run.jobs>();
  for (const j of f.run.jobs) byWorkflow.set(j.workflow, [...(byWorkflow.get(j.workflow) ?? []), j]);
  let id = 100;
  for (const [name, jobs] of byWorkflow) {
    const attempts = Math.max(...jobs.map((j) => j.attempts.length));
    gh.runs.push({ repo: p.repo, headSha: f.run.headSha, id, name, status: "completed", conclusion: "success", runAttempt: attempts, createdAt: new Date(start).toISOString() });
    for (let a = 1; a <= attempts; a++) {
      gh.jobsByAttempt.set(`${id}/${a}`, jobs.filter((j) => j.attempts[a - 1]).map((j, k) => ({ id: id * 100 + k * 10 + a, name: j.name, conclusion: j.attempts[a - 1]!.conclusion })));
      jobs.forEach((j, k) => j.attempts[a - 1]?.logExcerpt && gh.logs.set(id * 100 + k * 10 + a, j.attempts[a - 1]!.logExcerpt));
    }
    id++;
  }
  gh.diffs.set(`${p.repo}#${p.pull}`, f.run.diff);
  const at = new Date(start + i++ * 2 * HOUR);
  const deps = { github: gh, council: councilFor(p.fixture), withai: null, now: () => at };
  const runId = await noteWorkflowFinished(p.repo, f.run.headSha, p.pull, at);
  await processRun(runId, deps);
  runIds[p.fixture] = runId;
  if (p.fixture === "sensitive-auth") {
    // The person answered with the check run's button.
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    await answerFromGithub(run!, "jaytoday-test", "pass", "Thirty-day sessions were agreed with security.", "check-run-button", deps);
  }
  if (p.fixture === "flaky-and-sensitive") {
    // Half the deadline has passed: one reminder comment; still waiting for the person.
    await processOpenRuns({ ...deps, now: () => new Date(at.getTime() + 2.5 * HOUR) });
  }
}

// The daily threat model check for acme/payments: its map names src/deliveries.ts, which the default branch no longer has.
{
  const { checkThreatDrift } = await import("@/server/threat-drift");
  const gh = new FakeGitHub();
  const f = fixtures.find((x) => x.name === "threat-control-touched")!;
  gh.files.set("acme/payments", { "THREATS.md": f.run.files[0]!.text, "src/webhook.ts": "export function verifySignature() {}" });
  await checkThreatDrift(gh, "acme/payments", new Date());
}

const existing = await db.select().from((await import("@/lib/db/schema")).user);
if (!existing.length) await auth.api.signUpEmail({ body: { email: "owner@example.com", password: "pullup-dev-password", name: "Owner" } });
console.log(`Seeded ${plan.length} runs. Sign in as owner@example.com / pullup-dev-password.`);
process.exit(0);
