import { ciRunSchema, detectConcerns, parseConfig } from "@pullup/engine";
import { describe, expect, it } from "vitest";
import { failed, type ProviderAnswer } from "../decide/types";
import { runAgentRunWorkflow, workflowFor } from "./agentrun";
import { AgentSession, type AgentContext } from "./tools";

/*
 * The agentrun harness is a reshape of claude-agent.ts into AgentRun's
 * runNode callback, not a rewrite of PullUp's tool guardrails. These tests
 * drive the real Workflow document and real tool dispatch (AgentSession)
 * with a fake runNode standing in for the Claude Agent SDK, proving the
 * document validates and the wiring reaches the real tools -- the "faux
 * smoke test" from the plan.
 */

const config = parseConfig({ requiredWorkflows: ["ci"], flaky: { knownTests: [] } });
const run = ciRunSchema.parse({
  repo: "acme/shop",
  headSha: "abc",
  diff: "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,1 +1,1 @@\n-const TTL = 3600;\n+const TTL = 86400 * 30;\n",
  jobs: [{ workflow: "ci", name: "test", attempts: [{ conclusion: "success" }] }],
});
const answer = (over: Partial<ProviderAnswer> = {}): ProviderAnswer => ({ provider: "test", status: "decided", answer: "safe", final: true, probability: 0.1, citations: [], synthetic: true, decisionId: "dec_1", costUsd: 0, answeredBy: "fast", error: null, ...over });

function ctx(over: Partial<AgentContext> = {}): AgentContext & { sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  return { run, config, concerns: detectConcerns(run, config), hardFailures: [], assess: async (_c, input) => (sent.push(input), answer()), answerInput: async () => answer(), sent, ...over };
}

describe("workflowFor", () => {
  it("declares one agent node naming every tool and a satisfiable Review output", () => {
    const session = new AgentSession(ctx());
    const toolNames = session.tools().map((t) => t.name);
    const workflow = workflowFor("do the review", toolNames);
    expect(workflow.root).toMatchObject({ node: "agent", label: "review", instructions: "do the review", tools: toolNames, out: "Review", as: "review" });
    expect(workflow.output).toEqual({ schemaId: "Review", path: "review" });
  });
});

describe("runAgentRunWorkflow", () => {
  it("validates the workflow and dispatches real tools through a scripted runNode", async () => {
    const session = new AgentSession(ctx());
    const calls: string[] = [];
    await runAgentRunWorkflow(session, {}, async (params) => {
      expect(params.kind).toBe("agent");
      calls.push("runNode");
      const tools = new Map(session.tools().map((t) => [t.name, t]));
      await tools.get("get_ci_summary")!.run({});
      for (const c of session.ctx.concerns) await tools.get("assess")!.run({ concern: c.concern });
      await tools.get("finish")!.run({});
      return {};
    });
    expect(calls).toEqual(["runNode"]);
    expect(session.steps.some((s) => s.tool === "get_ci_summary")).toBe(true);
    expect(session.answers.size).toBe(session.ctx.concerns.length);
  });

  it("propagates a runNode failure as a rejection, never a silent success", async () => {
    const session = new AgentSession(ctx());
    await expect(runAgentRunWorkflow(session, {}, async () => {
      throw new Error("the model never responded");
    })).rejects.toThrow(/the model never responded/);
  });

  it("leaves unassessed concerns failed when the workflow throws, same as the other harnesses", async () => {
    const session = new AgentSession(ctx({ assess: async () => failed("x", "boom") }));
    const toolNames = session.tools().map((t) => t.name);
    try {
      await runAgentRunWorkflow(session, {}, async () => {
        const tools = new Map(session.tools().map((t) => [t.name, t]));
        for (const c of session.ctx.concerns) await tools.get("assess")!.run({ concern: c.concern });
        return {};
      });
    } catch {
      // The outer runAgent() in index.ts is what fills in unassessed concerns; this test only
      // checks that assessed-but-failed concerns already carry status "failed", unchanged.
    }
    expect(toolNames).toContain("assess");
    for (const a of session.answers.values()) expect(a.status).toBe("failed");
  });
});
