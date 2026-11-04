import { createHmac } from "node:crypto";
import { verifyChain } from "@pullup/engine";
import { fixedCouncil } from "@pullup/engine/testing";
import { FakeGitHub } from "@pullup/github";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, migrateDb } from "@/lib/db/client";
import { deliveries, evidence, runs, settings } from "@/lib/db/schema";
import { COLLECT_WAIT_MS, noteWorkflowFinished, type PipelineDeps, processRun } from "./pipeline";
import { evidenceChain, evidenceFor } from "./stores";

const scheduled: (() => unknown)[] = [];
vi.mock("next/server", async (actual) => ({ ...(await actual<typeof import("next/server")>()), after: (fn: () => unknown) => scheduled.push(fn) }));

const repo = "acme/shop";
const PASS = { verdict: "pass", strength: 5, reason: "fine", quotes: [] };
const T0 = new Date("2026-11-04T10:00:00Z");

function github(opts: { conclusion?: string; diff?: string; status?: string } = {}) {
  const gh = new FakeGitHub();
  gh.config.set(repo, JSON.stringify({ requiredWorkflows: ["ci"], ask: { to: "owner@example.com" } }));
  gh.runs.push({ repo, headSha: "s1", id: 10, name: "ci", status: opts.status ?? "completed", conclusion: opts.conclusion ?? "success", runAttempt: 1, createdAt: T0.toISOString() });
  gh.jobsByAttempt.set("10/1", [{ id: 1, name: "test", conclusion: opts.conclusion ?? "success" }]);
  gh.diffs.set(`${repo}#7`, opts.diff ?? "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n");
  return gh;
}

const deps = (gh: FakeGitHub, council = fixedCouncil(PASS), now = T0): PipelineDeps & { council: ReturnType<typeof fixedCouncil> } => ({ github: gh, council, now: () => now });

beforeAll(migrateDb);
beforeEach(async () => {
  for (const t of [runs, evidence, deliveries, settings]) await db.delete(t);
});

describe("the pipeline (shadow mode)", () => {
  it("waits for the required workflow, then decides, posts a neutral check and records a valid evidence chain", async () => {
    const gh = github({ status: "in_progress" });
    const id = await noteWorkflowFinished(repo, "s1", 7, T0);
    expect(await processRun(id, deps(gh))).toBe("collecting");
    expect(gh.checkRuns).toHaveLength(0);
    gh.runs[0]!.status = "completed";
    expect(await processRun(id, deps(gh))).toBe("decided");
    expect(gh.checkRuns).toEqual([expect.objectContaining({ name: "PullUp", headSha: "s1", status: "completed", conclusion: "neutral", title: "Shadow: would pass" })]);
    const [row] = await db.select().from(runs).where(eq(runs.id, id));
    expect(row).toMatchObject({ state: "decided", result: "pass", mode: "shadow", councilCalls: 0 });
    expect((await evidenceFor(id)).map((e) => e.kind)).toEqual(["collected", "decided", "permit-issued", "sent"]);
    expect(verifyChain(await evidenceChain(repo)).ok).toBe(true);
  });

  it("a hard failure is a would-be fail with no council call", async () => {
    const gh = github({ conclusion: "failure" });
    const d = deps(gh);
    expect(await processRun(await noteWorkflowFinished(repo, "s1", 7, T0), d)).toBe("decided");
    expect(d.council.calls).toBe(0);
    expect(gh.checkRuns[0]).toMatchObject({ conclusion: "neutral", title: "Shadow: would fail" });
  });

  it("uses the default branch config: a pull request that edits .pullup/config.json cannot switch a trigger off for itself", async () => {
    const diff = '--- a/.pullup/config.json\n+++ b/.pullup/config.json\n@@ -1 +1 @@\n-{"requiredWorkflows":["ci"]}\n+{"requiredWorkflows":["ci"],"triggers":{"sensitive-path":{"enabled":false}}}\n';
    const gh = github({ diff });
    const d = deps(gh);
    expect(await processRun(await noteWorkflowFinished(repo, "s1", 7, T0), d)).toBe("waiting");
    expect(d.council.calls).toBe(4);
    expect(gh.checkRuns[0]).toMatchObject({ conclusion: "neutral", title: "Shadow: would ask a person" });
  });

  it("without a config on the default branch the run is an error and nothing is posted", async () => {
    const gh = github();
    gh.config.clear();
    const id = await noteWorkflowFinished(repo, "s1", 7, T0);
    expect(await processRun(id, deps(gh))).toBe("error");
    expect(gh.checkRuns).toHaveLength(0);
    expect((await db.select().from(runs).where(eq(runs.id, id)))[0]!.error).toContain("No .pullup/config.json");
  });

  it("after the wait runs out, a required workflow that never finished is a hard failure", async () => {
    const gh = github({ status: "queued" });
    const id = await noteWorkflowFinished(repo, "s1", 7, T0);
    expect(await processRun(id, deps(gh, fixedCouncil(PASS), new Date(T0.getTime() + COLLECT_WAIT_MS)))).toBe("decided");
    expect(gh.checkRuns[0]!.title).toBe("Shadow: would fail");
    expect(gh.checkRuns[0]!.summary).toContain("Not finished when PullUp decided: ci");
  });

  it("a rerun reopens the same run and updates the same check run; two workers never process one run at once", async () => {
    const gh = github({ conclusion: "failure" });
    const id = await noteWorkflowFinished(repo, "s1", 7, T0);
    const [a, b] = await Promise.all([processRun(id, deps(gh)), processRun(id, deps(gh))]);
    expect([a, b].sort()).toEqual(["busy", "decided"]);
    gh.runs[0]!.runAttempt = 2;
    gh.jobsByAttempt.set("10/2", [{ id: 2, name: "test", conclusion: "success" }]);
    expect(await noteWorkflowFinished(repo, "s1", 7, T0)).toBe(id);
    // Failed, then passed on the rerun: a flaky test question, which this council passes.
    const d = deps(gh);
    expect(await processRun(id, d)).toBe("decided");
    expect(d.council.calls).toBe(4);
    expect(gh.checkRuns).toHaveLength(1);
    expect(gh.checkRuns[0]!.title).toBe("Shadow: would pass");
  });

  it("with the stop switch on, nothing is posted and the refusal is recorded", async () => {
    await db.insert(settings).values({ key: "stopped", value: true });
    const gh = github();
    const id = await noteWorkflowFinished(repo, "s1", 7, T0);
    await processRun(id, deps(gh));
    expect(gh.checkRuns).toHaveLength(0);
    expect((await evidenceFor(id)).map((e) => e.kind)).toEqual(["collected", "decided", "blocked"]);
  });
});

describe("the webhook route", () => {
  const sign = (body: string) => `sha256=${createHmac("sha256", "hook-secret").update(body).digest("hex")}`;
  const post = async (body: string, headers: Record<string, string>) => {
    const { POST } = await import("@/app/api/github/webhook/route");
    return POST(new Request("http://x/api/github/webhook", { method: "POST", body, headers }));
  };

  it("accepts a signed workflow_run once, ignores a redelivery, and refuses a bad signature", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "hook-secret";
    const body = JSON.stringify({ action: "completed", repository: { full_name: repo }, workflow_run: { head_sha: "s9", pull_requests: [{ number: 3 }] } });
    const headers = { "x-github-event": "workflow_run", "x-github-delivery": "d1", "x-hub-signature-256": sign(body) };
    scheduled.length = 0;
    expect((await post(body, headers)).status).toBe(202);
    expect(scheduled).toHaveLength(1);
    expect(await (await post(body, headers)).json()).toMatchObject({ duplicate: true });
    expect(scheduled).toHaveLength(1);
    expect((await post(body, { ...headers, "x-github-delivery": "d2", "x-hub-signature-256": "sha256=00" })).status).toBe(401);
    const [row] = await db.select().from(runs).where(eq(runs.headSha, "s9"));
    expect(row).toMatchObject({ repo, pull: 3, state: "collecting" });
  });
});
