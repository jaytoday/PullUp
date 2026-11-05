import { fixedCouncil } from "@pullup/engine/testing";
import { FakeGitHub } from "@pullup/github";
import type { CreateQuestionInput, PersonQuestion } from "@withai/client";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, migrateDb } from "@/lib/db/client";
import { asks, deliveries, evidence, repos, runs, settings } from "@/lib/db/schema";
import { type AskClient, parsePullupCommand } from "./asking";
import { answerFromGithub, answerFromWithai, noteWorkflowFinished, type PipelineDeps, processOpenRuns, processRun } from "./pipeline";
import { evidenceFor } from "./stores";

const repo = "acme/shop";
const T0 = new Date("2026-11-04T10:00:00Z").getTime();
const MIN = 60_000;
// A change to sign-in code: the sensitive path trigger, which only a person may pass.
const DIFF = "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1 +1 @@\n-export const MAX_AGE = 1;\n+export const MAX_AGE = 30;\n";
const NEEDS_PERSON = { verdict: "needs-person", strength: 4, reason: "sign-in code", quotes: [] };

class FakeWithAI implements AskClient {
  questions: (PersonQuestion & { input: CreateQuestionInput })[] = [];
  async askPerson(input: CreateQuestionInput) {
    const q = { id: `q${this.questions.length + 1}`, status: "open", answer: null, input } as unknown as PersonQuestion & { input: CreateQuestionInput };
    this.questions.push(q);
    return q;
  }
  async getQuestion(id: string) {
    return this.questions.find((q) => q.id === id)!;
  }
  async cancelQuestion(id: string) {
    const q = this.questions.find((x) => x.id === id)!;
    if (q.status === "open") q.status = "cancelled";
    return q;
  }
}

function setup(ask: Record<string, unknown> = {}, mode: "active" | "shadow" = "active") {
  const gh = new FakeGitHub();
  gh.config.set(repo, JSON.stringify({ requiredWorkflows: ["ci"], ask: { to: "owner@example.com", toGithub: "owner", deadlineMinutes: 60, ...ask } }));
  gh.runs.push({ repo, headSha: "s1", id: 10, name: "ci", status: "completed", conclusion: "success", runAttempt: 1, createdAt: new Date(T0).toISOString() });
  gh.jobsByAttempt.set("10/1", [{ id: 1, name: "test", conclusion: "success" }]);
  gh.diffs.set(`${repo}#7`, DIFF);
  gh.permissions.set("admin-user", "admin");
  gh.permissions.set("writer", "write");
  const withai = new FakeWithAI();
  const clock = { now: T0 };
  const deps: PipelineDeps = { github: gh, council: fixedCouncil(NEEDS_PERSON), withai, now: () => new Date(clock.now) };
  return { gh, withai, clock, deps, mode };
}

async function start(s: ReturnType<typeof setup>) {
  await db.insert(repos).values({ fullName: repo, mode: s.mode, createdAt: new Date(T0) });
  const id = await noteWorkflowFinished(repo, "s1", 7, new Date(T0));
  const state = await processRun(id, s.deps);
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  return { id, state, run: run! };
}

const check = (gh: FakeGitHub) => gh.checkRuns.at(-1)!;
const runRow = async (id: string) => (await db.select().from(runs).where(eq(runs.id, id)))[0]!;

beforeAll(migrateDb);
beforeEach(async () => {
  for (const t of [runs, evidence, deliveries, settings, asks, repos]) await db.delete(t);
  process.env.PULLUP_SKILL_ID = "skill-1";
});

describe("asking a person (active mode)", () => {
  it("asks through WithAI and shows the check in progress with Pass / Fail buttons", async () => {
    const s = setup();
    const { state } = await start(s);
    expect(state).toBe("waiting");
    expect(s.withai.questions).toHaveLength(1);
    const input = s.withai.questions[0]!.input;
    expect(input).toMatchObject({ to: { email: "owner@example.com" }, options: [{ id: "pass" }, { id: "fail" }], skillId: "skill-1", case: { repo, headSha: "s1", pull: 7, extension: "core", questionId: "core:sensitive-path" } });
    // WithAI keeps the question open a week past PullUp's deadline, for late answers.
    expect(Date.parse(input.deadline!)).toBe(T0 + 60 * MIN + 7 * 86_400_000);
    expect(input.details).toContain("src/auth/session.ts");
    expect(check(s.gh)).toMatchObject({ status: "in_progress", conclusion: null, actions: [{ identifier: "pass" }, { identifier: "fail" }] });
    expect(check(s.gh).title).toMatch(/^Waiting for owner@example.com: /);
  });

  it("the person's button decides; the first answer wins and the WithAI question is cancelled", async () => {
    const s = setup();
    const { run, id } = await start(s);
    expect(await answerFromGithub(run, "owner", "pass", "", "check-run-button", s.deps)).toEqual({ accepted: 1 });
    expect(check(s.gh)).toMatchObject({ status: "completed", conclusion: "success", title: "Passed" });
    expect(check(s.gh).actions).toBeUndefined();
    expect(s.withai.questions[0]!.status).toBe("cancelled");
    expect(await answerFromGithub(await runRow(id), "owner", "fail", "", "comment", s.deps)).toEqual({ accepted: 0, why: "Nothing is waiting for an answer on this run." });
    expect(check(s.gh).conclusion).toBe("success");
    expect((await evidenceFor(id)).map((e) => e.kind)).toContain("answered");
  });

  it("two answers at the same moment: exactly one is accepted", async () => {
    const s = setup();
    const { run } = await start(s);
    const results = await Promise.all([answerFromGithub(run, "owner", "pass", "", "check-run-button", s.deps), answerFromGithub(run, "admin-user", "fail", "", "comment", s.deps)]);
    expect(results.map((r) => r.accepted).sort()).toEqual([0, 1]);
    const winner = results[0]!.accepted ? "success" : "failure";
    expect(check(s.gh).conclusion).toBe(winner);
  });

  it("only the person asked or a repo admin may answer from GitHub", async () => {
    const s = setup();
    const { run } = await start(s);
    expect(await answerFromGithub(run, "writer", "pass", "", "comment", s.deps)).toMatchObject({ accepted: 0, why: "Only the people asked or a repo admin can answer." });
    expect(check(s.gh).status).toBe("in_progress");
    expect(await answerFromGithub(run, "admin-user", "fail", "token lifetime too long", "comment", s.deps)).toEqual({ accepted: 1 });
    expect(check(s.gh)).toMatchObject({ conclusion: "failure" });
    expect(check(s.gh).summary).toContain("github:admin-user answered \"fail\". token lifetime too long");
  });

  it("an answer through WithAI counts as the person it was sent to; the worker also finds answers WithAI did not deliver", async () => {
    const s = setup();
    await start(s);
    expect(await answerFromWithai("q1", "fail", "no", s.deps)).toEqual({ accepted: 1 });
    expect(check(s.gh).conclusion).toBe("failure");

    for (const t of [runs, asks, repos]) await db.delete(t);
    const s2 = setup();
    await start(s2);
    Object.assign(s2.withai.questions[0]!, { status: "answered", answer: { optionId: "pass", text: "fine" } });
    await processOpenRuns(s2.deps);
    expect(check(s2.gh).conclusion).toBe("success");
  });

  it("reminds once at half time on the pull request, then fails at the deadline; a late answer replaces that", async () => {
    const s = setup();
    const { id } = await start(s);
    s.clock.now = T0 + 31 * MIN;
    await processOpenRuns(s.deps);
    await processOpenRuns(s.deps);
    expect(s.gh.comments).toHaveLength(1);
    expect(s.gh.comments[0]).toMatchObject({ repo, issue: 7 });
    expect(s.gh.comments[0]!.body).toMatch(/^@owner PullUp is waiting for your answer/);
    s.clock.now = T0 + 61 * MIN;
    await processOpenRuns(s.deps);
    expect(check(s.gh)).toMatchObject({ conclusion: "failure" });
    expect(check(s.gh).summary).toContain("No answer from owner@example.com.");
    expect(await answerFromGithub(await runRow(id), "owner", "pass", "", "comment", s.deps)).toEqual({ accepted: 1 });
    expect(check(s.gh).conclusion).toBe("success");
  });

  it("each no-answer option decides as documented", async () => {
    const outcome = async (ask: Record<string, unknown>, steps: number[]) => {
      for (const t of [runs, asks, repos, evidence]) await db.delete(t);
      const s = setup(ask);
      await start(s);
      for (const m of steps) {
        s.clock.now = T0 + m * MIN;
        await processOpenRuns(s.deps);
      }
      return { check: check(s.gh), withai: s.withai };
    };
    expect((await outcome({ onNoAnswer: "pass" }, [61])).check).toMatchObject({ conclusion: "success" });
    expect((await outcome({ onNoAnswer: "pass" }, [61])).check.summary).toContain("Passed without an answer");
    // A person-decides trigger: following the council's lean never passes it.
    expect((await outcome({ onNoAnswer: "follow-council" }, [61])).check).toMatchObject({ conclusion: "failure" });
    const escalated = await outcome({ onNoAnswer: "escalate", backup: "+15551234567", onNoAnswerAfterBackup: "pass" }, [61]);
    expect(escalated.check.status).toBe("in_progress");
    expect(escalated.withai.questions.map((q) => q.input.to)).toEqual([{ email: "owner@example.com" }, { phone: "+15551234567" }]);
    expect((await outcome({ onNoAnswer: "escalate", backup: "+15551234567", onNoAnswerAfterBackup: "pass" }, [61, 122])).check).toMatchObject({ conclusion: "success" });
  });

  it("in shadow mode no one is asked: the check is neutral and says it would ask", async () => {
    const s = setup({}, "shadow");
    const { state } = await start(s);
    expect(state).toBe("waiting");
    expect(s.withai.questions).toHaveLength(0);
    expect(check(s.gh)).toMatchObject({ conclusion: "neutral", title: "Shadow: would ask a person" });
    expect(check(s.gh).actions).toBeUndefined();
  });
});

describe("/pullup comments", () => {
  it("are read only at the start of a comment", () => {
    expect(parsePullupCommand("/pullup pass looks fine")).toEqual({ value: "pass", reason: "looks fine" });
    expect(parsePullupCommand("  /PullUp FAIL")).toEqual({ value: "fail", reason: "" });
    expect(parsePullupCommand("I think /pullup pass")).toBeNull();
    expect(parsePullupCommand("/pullup passed")).toBeNull();
  });
});

describe("extensions on a live repository", () => {
  const THREATS = "## In scope\n| ID | Threat | Control | Code |\n| --- | --- | --- | --- |\n| T1 | Stolen session | Sessions expire after a day | `src/auth/session.ts` |\n";

  it("threat model and code owners: the control question goes to the file's owner, with an annotation, and the owner's GitHub button counts", async () => {
    const s = setup();
    s.gh.config.set(
      repo,
      JSON.stringify({
        requiredWorkflows: ["ci"],
        ask: { to: "owner@example.com", deadlineMinutes: 60 },
        extensions: { "threat-model": { mode: "active" }, codeowners: { mode: "active", people: { "@alice": "alice@example.com" } }, "doc-links": { mode: "shadow" } },
      }),
    );
    s.gh.files.set(repo, { "THREATS.md": THREATS, ".github/CODEOWNERS": "/src/auth/ @alice\n" });
    s.gh.files.set(`${repo}@s1`, { "THREATS.md": THREATS });
    const { id, state } = await start(s);
    expect(state).toBe("waiting");
    const run = await runRow(id);
    const asked = (await db.select().from(asks).where(eq(asks.runId, id))).map((a) => a.questionId).sort();
    expect(asked).toEqual(["core:sensitive-path", "threat-model:T1"]);
    expect(s.withai.questions.map((q) => [q.input.to, (q.input.case as { questionId: string }).questionId])).toEqual([
      [{ email: "alice@example.com" }, "core:sensitive-path"],
      [{ email: "alice@example.com" }, "threat-model:T1"],
    ]);
    expect(check(s.gh).annotations).toEqual([{ path: "src/auth/session.ts", line: 1, level: "warning", message: "This code implements the control for T1 (Stolen session): Sessions expire after a day [threat-model]" }]);
    expect(check(s.gh).summary).toContain("### threat-model");
    // Alice answers with her GitHub login: it counts as alice@example.com, who was asked.
    expect(await answerFromGithub(run, "alice", "pass", "", "check-run-button", s.deps)).toEqual({ accepted: 2 });
    expect(check(s.gh)).toMatchObject({ conclusion: "success" });
  });

  it("a Shadow extension's questions are shown but never asked and never hold the check", async () => {
    const s = setup();
    s.gh.config.set(repo, JSON.stringify({ requiredWorkflows: ["ci"], ask: { to: "owner@example.com" }, extensions: { core: { mode: "shadow" }, "threat-model": { mode: "shadow" } } }));
    s.gh.files.set(repo, { "THREATS.md": THREATS });
    const { id, state } = await start(s);
    expect(state).toBe("decided");
    expect(await db.select().from(asks).where(eq(asks.runId, id))).toEqual([]);
    expect(check(s.gh)).toMatchObject({ conclusion: "success" });
    expect(check(s.gh).summary).toContain("Would ask (Shadow extensions, not counted)");
    expect(check(s.gh).annotations![0]).toMatchObject({ level: "notice", message: expect.stringMatching(/^\(Shadow\) /) });
  });
});
