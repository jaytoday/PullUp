import { ciRunSchema } from "@pullup/sdk";
import type { ApplyInput, ApplyResult } from "@withai/client";
import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";
import type { RawSeatAnswer } from "./council";
import { decideRun } from "./resolution";
import { askScreens, checkScreen, type PlannedScreen, recordingScreener, replayScreener, type Screener, withaiScreener } from "./screens";
import { fixedCouncil } from "./testing";
import type { Recording } from "./withai-council";

const DIFF = "--- a/src/cart.ts\n+++ b/src/cart.ts\n@@ -1,1 +1,2 @@\n const total = 1;\n+console.log(total);\n--- a/src/other.ts\n+++ b/src/other.ts\n@@ -1 +1 @@\n-x\n+debugger; // other file\n";
const RULE = "---\nappliesTo: \"*.ts\"\ntype: noul\n---\nDoes this file leave debugging code (console.log, debugger) behind?\n";
const run = ciRunSchema.parse({
  repo: "acme/shop",
  headSha: "abc1234",
  jobs: [{ workflow: "ci", name: "t", attempts: [{ conclusion: "success" }] }],
  diff: DIFF,
  files: [{ path: ".pullup/rules/no-debug.md", text: RULE, from: "default" }],
});
const screen: PlannedScreen = { key: "k", id: "repo-rules:k", extension: "repo-rules", question: "q?", guidance: "", file: "src/cart.ts", options: ["yes", "no"] };
const raw = (answer: unknown, error?: string): RawSeatAnswer => ({ seat: screen.id, answer, ...(error ? { error } : {}) });
const config = (extra: Record<string, unknown> = {}) => parseConfig({ requiredWorkflows: ["ci"], ask: { to: "a@example.com" }, extensions: { "repo-rules": { mode: "active" } }, ...extra });
const PASS = { verdict: "pass", strength: 5, reason: "ok", quotes: [] };

describe("checking a screen answer", () => {
  it("accepts an answer from the options, with quotes found on changed lines of that file", () => {
    expect(checkScreen(raw({ result: "yes", confidence: 0.9, reason: "r", quotes: [{ text: "+console.log(total);" }] }), screen, run)).toEqual({
      key: "k", status: "answered", result: "yes", confidence: 0.9, reason: "r", quotes: [{ text: "console.log(total);", line: 2, file: "src/cart.ts" }], why: null,
    });
    expect(checkScreen(raw({ result: "no", confidence: 0.8, reason: "r", quotes: [] }), screen, run).status).toBe("answered");
  });

  it("anything else is not checked: a failed call, a bad shape, an unknown answer, a problem with no quote, a quote from another file or a context line", () => {
    const why = (a: RawSeatAnswer) => checkScreen(a, screen, run).why;
    expect(why(raw(null, "timeout"))).toBe("the call failed: timeout");
    expect(why(raw({ result: "yes" }))).toMatch(/wrong shape/);
    expect(why(raw({ result: "maybe", confidence: 1, reason: "", quotes: [] }))).toMatch(/not one of yes, no/);
    expect(why(raw({ result: "yes", confidence: 1, reason: "", quotes: [] }))).toMatch(/no quote found/);
    expect(why(raw({ result: "yes", confidence: 1, reason: "", quotes: [{ text: "debugger; // other file" }] }))).toMatch(/no quote found/);
    expect(why(raw({ result: "yes", confidence: 1, reason: "", quotes: [{ text: "const total = 1;" }] }))).toMatch(/no quote found/);
  });
});

describe("asking screens", () => {
  it("asks at most the run's limit; the rest, and everything without a screen service, are not checked", async () => {
    const planned = [1, 2, 3].map((i) => ({ ...screen, key: `k${i}`, id: `repo-rules:k${i}` }));
    let calls = 0;
    const screener: Screener = async (s) => (calls++, { seat: s.id, answer: { result: "no", confidence: 0.9, reason: "", quotes: [] }, costUsd: 0.001 });
    const asked = await askScreens(planned, run, screener, 2);
    expect(asked.answers.get("repo-rules")!.map((a) => a.status)).toEqual(["answered", "answered", "not-checked"]);
    expect(asked.answers.get("repo-rules")![2]!.why).toBe("over the run's limit of 2 screens");
    expect([calls, asked.calls, asked.costUsd]).toEqual([2, 2, 0.002]);
    expect((await askScreens(planned, run, null, 10)).answers.get("repo-rules")![0]!.why).toMatch(/no screen service/);
    const throwing: Screener = async () => {
      throw new Error("boom");
    };
    expect((await askScreens(planned, run, throwing, 10)).answers.get("repo-rules")![0]!.why).toBe("the call failed: boom");
  });
});

describe("screens in a run", () => {
  const yes: Screener = async (s) => ({ seat: s.id, answer: { result: s.file === "src/cart.ts" ? "yes" : "no", confidence: 0.9, reason: "a log line", quotes: [{ text: "console.log(total);" }] } });

  it("a rule broken by the change raises a question the council decides; the screens are on the record", async () => {
    const decision = await decideRun(run, config(), fixedCouncil(PASS), { now: 0, screener: yes });
    expect(decision.questions.map((q) => [q.question.id, q.outcome])).toEqual([["repo-rules:no-debug", "pass"]]);
    expect(decision.extensions!.screens.map((s) => [s.extension, s.key, s.result])).toEqual([
      ["repo-rules", "no-debug:0", "yes"],
      ["repo-rules", "no-debug:1", "no"],
    ]);
    expect(decision.extensions!.screenCalls).toBe(2);
  });

  it("with no screen service, the files are not checked and that is a question, never a silent pass", async () => {
    const decision = await decideRun(run, config(), fixedCouncil(PASS), { now: 0 });
    expect(decision.questions.map((q) => q.question.id)).toEqual(["repo-rules:not-checked"]);
  });

  it("screens beyond screens.maxPerRun are not checked", async () => {
    const decision = await decideRun(run, config({ screens: { maxPerRun: 1 } }), fixedCouncil(PASS), { now: 0, screener: yes });
    expect(decision.extensions!.screens.map((s) => s.status)).toEqual(["answered", "not-checked"]);
    expect(decision.questions.map((q) => q.question.id)).toEqual(["repo-rules:no-debug", "repo-rules:not-checked"]);
  });

  it("records screen answers next to the council's, and replays them with no call", async () => {
    const recording: Recording = {};
    const first = await decideRun(run, config(), fixedCouncil(PASS), { now: 0, screener: recordingScreener(yes, recording) });
    expect(Object.keys(recording)).toEqual(["abc1234/screen/repo-rules:no-debug:0", "abc1234/screen/repo-rules:no-debug:1"]);
    const again = await decideRun(run, config(), fixedCouncil(PASS), { now: 0, screener: replayScreener(recording) });
    expect(again.questions).toEqual(first.questions);
    expect((await replayScreener({})(screen, run)).error).toBe("no recorded answer for this screen");
  });
});

describe("the WithAI screener", () => {
  it("makes one cheap apply call with the question, the options, the guidance and the file's changed lines, and unwraps the answer", async () => {
    const inputs: ApplyInput[] = [];
    const client = {
      async apply(input: ApplyInput) {
        inputs.push(input);
        return { runId: "r", status: "ok", model: "m", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001, durationMs: 5, answer: { type: "schema", value: { result: "no", confidence: 0.7, reason: "", quotes: [] } } } as unknown as ApplyResult;
      },
    };
    const answer = await withaiScreener({ client, skill: { text: "guidance" } })({ ...screen, guidance: "No debugging code." }, run);
    expect(answer).toMatchObject({ seat: "repo-rules:k", answer: { result: "no", confidence: 0.7 }, costUsd: 0.001 });
    expect(inputs[0]).toMatchObject({ tier: "cheap", maxTokens: 1024, state: { guidance: "No debugging code." } });
    expect(inputs[0]!.request).toContain('Answer with exactly one of: "yes", "no"');
    const code = (inputs[0]!.state as { changedCode: string }).changedCode;
    expect(code).toContain("+2: console.log(total);");
    expect(code).not.toContain("other.ts");
  });

  it("a call that throws or is cut off comes back as an error, which the host treats as not checked", async () => {
    const client = {
      async apply(): Promise<ApplyResult> {
        throw Object.assign(new Error("slow"), { name: "TimeoutError" });
      },
    };
    expect((await withaiScreener({ client, skill: { text: "g" } })(screen, run)).error).toBe("WithAI did not answer in time");
  });
});
