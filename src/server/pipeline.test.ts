import { createFauxAskWithAI } from "@askwithai/sdk/testing";
import { type CiRun, type ConfigInput } from "@pullup/engine";
import { FakeGitHub } from "@pullup/github";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, migrateDb } from "@/lib/db/client";
import { assessments, repos, runs } from "@/lib/db/schema";
import { matureOutcomes, noteMerged, noteReverted } from "./outcomes";
import { answerFromGithub, noteWorkflowFinished, type PipelineDeps, processRun } from "./pipeline";
import { loadGitHub } from "./demo-github";
import { MERGE_RISK } from "./decide/types";

/*
 * The whole pipeline on a fake GitHub and AskWithAI's faux server: hard
 * failures and clean runs make no decision call; concerns go through the
 * agent's tools (scripted planner) to the runtime; the fixed policy decides;
 * a person's GitHub answer settles the AskWithAI review; a missing fact is
 * answered from the repository; outcomes are reported once.
 */

beforeAll(migrateDb);

const REPO = "acme/shop";
const CONFIG: ConfigInput = { requiredWorkflows: ["ci"], flaky: { knownTests: ["cart.spec.ts > totals"] }, reviewers: ["sam"] };
// The same prompt as askwithai/runtime.yaml: compatible endpoints match questions by key or exact instructions.
const QUESTION = { key: "merge_risk", type: "binary" as const, prompt: MERGE_RISK.instructions, labels: ["risky", "safe"] };
const ok = { conclusion: "success" as const };

let n = 0;
function pull(over: Partial<Omit<CiRun, "pull">> = {}): CiRun & { pull: NonNullable<CiRun["pull"]> } {
  n++;
  return { repo: REPO, headSha: `sha${n}${Date.now()}`, diff: "", jobs: [{ workflow: "ci", name: "test", attempts: [ok] }], pull: { number: 100 + n, title: `Change ${n}`, body: "", labels: [], author: "alice" }, ...over };
}
const flaky = (log = "ECONNRESET while calling the test database") => ({ jobs: [{ workflow: "ci", name: "test", attempts: [{ conclusion: "failure" as const, failedTests: ["orders.spec.ts > lists"], logExcerpt: log }, ok] }] });
const SENSITIVE = "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,1 +1,1 @@\n-const TTL = 3600;\n+const TTL = 86400 * 30;\n";

function world(opts: { answer?: "risky" | "safe"; review?: boolean; input?: boolean; decider?: string; mode?: "report_only" | "enforce" } = {}) {
  const faux = createFauxAskWithAI({
    runtimes: { "acme/ci-review": { questions: [QUESTION] } },
    answer: opts.answer ? () => opts.answer : undefined,
    reviewWhen: () => !!opts.review,
    inputWhen: ({ input }) => (opts.input && !(input.reviewerInput as Record<string, unknown> | undefined)?.known_flaky && (input.reviewerInput as Record<string, unknown> | undefined)?.known_flaky !== false ? { field: "known_flaky", question: "Is the failing test on the known-flaky list?", schema: { type: "boolean" } } : null),
  });
  const github = new FakeGitHub();
  github.config.set(REPO, JSON.stringify(CONFIG));
  github.permissions.set("admin-ann", "admin");
  const env = { ASKWITHAI_API_KEY: "wai_test_faux_key_000000000000", ASKWITHAI_URL: faux.url, PULLUP_RUNTIME: "acme/ci-review", PULLUP_DECIDER: opts.decider ?? "askwithai", PULLUP_PERMIT_KEY: "test-permit-key", JEV_BASE_URL: `${faux.url}/v1/runtimes/acme/ci-review`, JEV_API_KEY: "wai_test_faux_key_000000000000" };
  const deps: PipelineDeps = { github, env, fetch: faux.fetch, now: () => new Date() };
  const play = async (p: ReturnType<typeof pull>) => {
    loadGitHub(github, p);
    await db.insert(repos).values({ fullName: REPO, createdAt: new Date(), checkMode: opts.mode ?? "report_only" }).onConflictDoUpdate({ target: repos.fullName, set: { checkMode: opts.mode ?? "report_only" } });
    const id = await noteWorkflowFinished(REPO, p.headSha, p.pull.number, new Date());
    const state = await processRun(id, deps);
    const [row] = await db.select().from(runs).where(eq(runs.id, id));
    return { id, state, row: row!, assessments: await db.select().from(assessments).where(eq(assessments.runId, id)) };
  };
  return { faux, github, deps, play };
}

describe("pipeline", () => {
  it("a clean run passes and a hard failure fails, with no decision call", async () => {
    const w = world();
    expect((await w.play(pull())).row).toMatchObject({ result: "pass", state: "decided" });
    const hard = await w.play(pull({ jobs: [{ workflow: "ci", name: "test", attempts: [{ conclusion: "failure", failedTests: ["a > b"], logExcerpt: "boom" }] }] }));
    expect(hard.row.result).toBe("fail");
    expect(w.faux.decisions()).toHaveLength(0);
    // Report only: the check is neutral and says what PullUp would do.
    expect(w.github.checkRuns.at(-1)).toMatchObject({ conclusion: "neutral", title: "Report only: would fail" });
  });

  it("a flaky retry goes to the runtime through the agent, with the head commit as trace id", async () => {
    const w = world({ answer: "safe" });
    const p = pull(flaky());
    const r = await w.play(p);
    expect(r.row).toMatchObject({ result: "pass", decider: "askwithai", harness: "scripted" });
    expect(r.assessments[0]).toMatchObject({ concern: "flaky_retry", answer: "safe", final: true, synthetic: true });
    expect(r.row.agentSteps.map((s) => s.tool)).toEqual(["get_ci_summary", "read_log", "assess", "finish"]);
    expect(w.faux.decisions()[0]!.decision.traceId).toBe(p.headSha);
    expect(w.faux.decisions()[0]!.input).toMatchObject({ concern: "flaky_retry", repository: REPO, evidence: [{ source: "log", text: "ECONNRESET while calling the test database" }] });
  });

  it("risky with no checked quote waits for a person; in Enforce the check stays in progress with Pass and Fail buttons", async () => {
    const w = world({ answer: "risky", mode: "enforce" });
    const r = await w.play(pull({ diff: SENSITIVE }));
    expect(r.row.result).toBe("waiting");
    expect(w.github.checkRuns.at(-1)).toMatchObject({ status: "in_progress", actions: [{ identifier: "pass" }, { identifier: "fail" }] });
  });

  it("Enforce never passes on simulated answers", async () => {
    const w = world({ answer: "safe", mode: "enforce" });
    expect((await w.play(pull(flaky()))).row.result).toBe("waiting");
  });

  it("a reviewer's GitHub answer settles the AskWithAI review; anyone else is refused", async () => {
    const w = world({ review: true, mode: "enforce" });
    const r = await w.play(pull({ diff: SENSITIVE }));
    expect(r.row.result).toBe("waiting");
    expect(w.faux.reviews().filter((x) => x.status === "pending")).toHaveLength(1);
    expect(await answerFromGithub(r.id, "mallory", "pass", "", "comment", w.deps)).toMatchObject({ accepted: false });
    expect(await answerFromGithub(r.id, "sam", "fail", "session lifetime is too long", "comment", w.deps)).toMatchObject({ accepted: true });
    expect(w.faux.reviews()[0]).toMatchObject({ status: "settled", decision: "risky" });
    const [row] = await db.select().from(runs).where(eq(runs.id, r.id));
    expect(row).toMatchObject({ result: "fail", state: "decided" });
    expect(w.github.checkRuns.at(-1)).toMatchObject({ conclusion: "failure" });
  });

  it("a missing fact is answered from the repository's known-flaky list, and the decision resumes", async () => {
    const w = world({ input: true, answer: "safe" });
    const r = await w.play(pull(flaky()));
    expect(r.row.agentSteps.map((s) => s.tool)).toContain("answer_input_request");
    expect(r.row.agentSteps.find((s) => s.tool === "answer_input_request")!.summary).toMatch(/known_flaky = false/);
    expect(r.assessments[0]).toMatchObject({ status: "decided", answer: "safe" });
  });

  it("the same input through Jev's client at AskWithAI's System One endpoint keeps the decision id", async () => {
    const w = world({ decider: "jev" });
    const r = await w.play(pull(flaky()));
    expect(r.row.decider).toBe("jev");
    expect(r.assessments[0]!.provider, JSON.stringify(r.assessments[0])).toBe("jev");
    expect(r.assessments[0]!.decisionId).toMatch(/^dec_/);
    expect(w.faux.decisions()).toHaveLength(1);
  });

  it("reports merged-and-kept as safe after 7 days and a revert as risky, once each", async () => {
    const w = world({ answer: "safe" });
    const kept = await w.play(pull(flaky()));
    const reverted = await w.play(pull(flaky("socket hang up")));
    await noteMerged(REPO, kept.row.pull!, new Date(Date.now() - 8 * 86_400_000));
    await noteMerged(REPO, reverted.row.pull!, new Date());
    expect(await noteReverted(REPO, reverted.row.pull!, new Date(), w.deps)).toBe(1);
    expect(await matureOutcomes(w.deps)).toBe(1);
    expect(await matureOutcomes(w.deps)).toBe(0);
    expect(w.faux.outcomes().map((o) => o.labels.merge_risk).sort()).toEqual(["risky", "safe"]);
  });
});
