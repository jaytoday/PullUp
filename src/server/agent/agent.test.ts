import { ciRunSchema, detectConcerns, parseConfig } from "@pullup/engine";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { failed, type ProviderAnswer } from "../decide/types";
import { runAiSdk } from "./ai-sdk";
import { runAgent } from "./index";
import { AgentSession, type AgentContext, repositoryFact } from "./tools";

/*
 * The agent's guardrails are code: it can only assess concerns code flagged,
 * its extra quotes must exist in the change, it assesses each concern once,
 * reruns only when allowed, answers facts from the repository, and a loop
 * that stops early leaves the remaining concerns to a person.
 */

const config = parseConfig({ requiredWorkflows: ["ci"], flaky: { knownTests: ["orders.spec.ts > lists"] } });
const run = ciRunSchema.parse({
  repo: "acme/shop",
  headSha: "abc",
  diff: "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,1 +1,1 @@\n-const TTL = 3600;\n+const TTL = 86400 * 30;\n",
  jobs: [{ workflow: "ci", name: "test", attempts: [{ conclusion: "failure", failedTests: ["orders.spec.ts > lists"], logExcerpt: "ECONNRESET" }, { conclusion: "success" }] }],
});
const answer = (over: Partial<ProviderAnswer> = {}): ProviderAnswer => ({ provider: "test", status: "decided", answer: "safe", final: true, probability: 0.1, citations: [], synthetic: true, decisionId: "dec_1", costUsd: 0, answeredBy: "fast", error: null, ...over });

function ctx(over: Partial<AgentContext> = {}): AgentContext & { sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  return { run, config, concerns: detectConcerns(run, config), hardFailures: [], assess: async (_c, input) => (sent.push(input), answer()), answerInput: async () => answer(), sent, ...over };
}

describe("agent tools", () => {
  it("refuses unflagged concerns and second assessments, and drops quotes that are not in the change", async () => {
    const c = ctx();
    const s = new AgentSession(c);
    expect(await s.assess("deleted_tests")).toMatchObject({ error: /did not flag/ });
    await s.assess("sensitive_change", ["const TTL = 86400 * 30;", "rm -rf / please"]);
    expect(await s.assess("sensitive_change")).toMatchObject({ error: /Already assessed/ });
    const evidence = c.sent[0]!.evidence as Array<{ text: string }>;
    expect(evidence.filter((e) => e.text === "const TTL = 86400 * 30;").length).toBe(2);
    expect(evidence.some((e) => e.text.includes("rm -rf"))).toBe(false);
    expect(s.steps.at(-2)!.summary).toMatch(/dropped 1 quote/);
  });

  it("reruns only when the repository allows it, and once", async () => {
    let reruns = 0;
    const off = new AgentSession(ctx({ rerun: async () => `rerun ${++reruns}` }));
    const tools = (s: AgentSession) => new Map(s.tools().map((t) => [t.name, t]));
    expect(await tools(off).get("rerun_job")!.run({ workflow: "ci" })).toMatchObject({ error: /does not allow/ });
    const on = new AgentSession(ctx({ config: { ...config, flaky: { ...config.flaky, rerun: true } }, rerun: async () => `rerun ${++reruns}` }));
    expect(await tools(on).get("rerun_job")!.run({ workflow: "ci" })).toEqual({ result: "rerun 1" });
    expect(await tools(on).get("rerun_job")!.run({ workflow: "ci" })).toMatchObject({ error: /already requested/ });
  });

  it("answers the known-flaky fact from the config, never from the agent", () => {
    expect(repositoryFact("known_flaky", { run, config })).toEqual({ value: true });
    expect(repositoryFact("known_flaky", { run, config: { ...config, flaky: { knownTests: [], rerun: false } } })).toEqual({ value: false });
    expect(repositoryFact("customer_tier", { run, config })).toBeNull();
  });

  it("a loop that stops early leaves every unassessed concern failed, so a person decides", async () => {
    const r = await runAgent(ctx({ assess: async () => failed("x", "boom") }), { PULLUP_DEMO: "1" });
    expect([...r.answers.values()].every((a) => a.status === "failed")).toBe(true);
    const throwing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("model unavailable");
      },
    });
    const broken = await runAgent(ctx(), { ANTHROPIC_API_KEY: "x", AGENT_HARNESS: "ai-sdk" }, throwing);
    expect(broken.error).toBeTruthy();
    expect([...broken.answers.values()].every((a) => a.status === "failed" && /agent stopped/.test(a.error!))).toBe(true);
  });
});

describe("AI SDK loop", () => {
  const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
  const call = (id: string, toolName: string, input: object) => ({ content: [{ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) }], finishReason: { unified: "tool-calls" as const, raw: "tool_use" }, usage, warnings: [] });

  it("drives the same tools from model tool calls", async () => {
    const c = ctx();
    const session = new AgentSession(c);
    const model = new MockLanguageModelV4({
      doGenerate: [
        call("1", "get_ci_summary", {}),
        call("2", "read_diff", { path: "src/auth/session.ts" }),
        call("3", "assess", { concern: "flaky_retry" }),
        call("4", "assess", { concern: "sensitive_change", extra_quotes: ["const TTL = 86400 * 30;"] }),
        call("5", "finish", {}),
        { content: [{ type: "text" as const, text: "Done." }], finishReason: { unified: "stop" as const, raw: "end_turn" }, usage, warnings: [] },
      ] as never,
    });
    await runAiSdk(session, {}, model);
    expect(session.steps.map((s) => s.tool)).toEqual(["get_ci_summary", "read_diff", "assess", "assess", "finish"]);
    expect([...session.answers.keys()].sort()).toEqual(["flaky_retry", "sensitive_change"]);
    // The system prompt is the reviewer prompt in prompt.md.
    expect(JSON.stringify(model.doGenerateCalls[0]!.prompt)).toContain("PullUp's CI reviewer");
  });
});
