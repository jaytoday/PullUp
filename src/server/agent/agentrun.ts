import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { Workflow, WorkflowDeps } from "@parcha/agentrun-dsl";
import { EscalationSignal, runWorkflow } from "@parcha/agentrun-dsl";
import { agentPrompt, MAX_STEPS } from "./ai-sdk";
import type { AgentSession } from "./tools";

/**
 * The same agent as `claude-agent.ts` (`AGENT_HARNESS=agentrun`), declared as
 * a one-node AgentRun `Workflow` and run with `runWorkflow` in-process
 * instead of calling the Claude Agent SDK directly. `runWorkflow` validates
 * the document's structure (tool names, the `out` contract) before it runs
 * — a check that did not exist before this harness — and turns any runner
 * failure into `WorkflowRunResult`'s typed `escalated`/thrown-error outcomes
 * instead of a bare exception.
 *
 * This is one `agent` node, not a multi-node graph: PullUp's agent
 * investigates and calls `assess` interleaved, choosing when to assess each
 * concern as it reads evidence, which is exactly what one continuous
 * tool-calling conversation does and what AgentRun's `agent` node models.
 * Splitting "investigate" and "assess" into separate graph nodes (an
 * investigation node followed by a `map` of `call` nodes, one per concern)
 * would let AgentRun's recovery journal resume mid-review and would be the
 * natural place to route `assess` through `askwithaiEffect`
 * (`@askwithai/sdk/agentrun-effect`) as a true graph-level effect — but it
 * would also change today's interleaved investigate-then-assess-per-concern
 * order, which this pass deliberately does not risk. `assess` therefore
 * stays one of this node's own tools, unchanged, exactly as in
 * `claude-agent.ts`. AskWithAI's own idempotency key
 * (`pullup:<run>:<concern>`, built in `pipeline.ts` and already independent
 * of which harness is running) already makes a repeated `assess` call safe
 * to retry without double-billing or double-asking, so this pass loses no
 * real durability for the one thing that talks to AskWithAI.
 */

const REVIEW_SCHEMA: Record<string, unknown> = { type: "object", properties: {}, additionalProperties: true };

/** Exported so tests can check the workflow document's structure directly, independent of the Claude Agent SDK. */
export function workflowFor(instructions: string, toolNames: string[]): Workflow {
  return {
    v: 2,
    name: "pullup-review",
    schemas: { Review: REVIEW_SCHEMA },
    root: { node: "agent", label: "review", instructions, tools: toolNames, out: "Review", as: "review" },
    output: { schemaId: "Review", path: "review" },
  };
}

/** The real `runNode`: the same Claude Agent SDK call `claude-agent.ts` makes, reshaped to AgentRun's callback. */
function claudeRunNode(session: AgentSession, env: Record<string, string | undefined>, server: ReturnType<typeof createSdkMcpServer>, toolNames: string[]): WorkflowDeps["runNode"] {
  return async (params) => {
    if (params.kind !== "agent") throw new Error(`agentrun harness: unexpected node kind "${params.kind}"`);
    const stream = query({
      prompt: `Review CI for ${session.ctx.run.repo} at ${session.ctx.run.headSha}. Start with get_ci_summary.`,
      options: {
        systemPrompt: params.system.join("\n\n"),
        model: env.AGENT_MODEL ?? "claude-haiku-4-5",
        mcpServers: { pullup: server },
        tools: [],
        allowedTools: toolNames.map((name) => `mcp__pullup__${name}`),
        maxTurns: params.maxTurns ?? MAX_STEPS,
      },
    });
    for await (const message of stream) if (message.type === "result") break;
    return {};
  };
}

/** `runNode` is injectable so a test can drive the real workflow document and real tool dispatch without the Claude Agent SDK. */
export async function runAgentRunWorkflow(session: AgentSession, env: Record<string, string | undefined> = process.env, runNode?: WorkflowDeps["runNode"]): Promise<void> {
  const specs = session.tools();
  const toolNames = specs.map((t) => t.name);
  const server = createSdkMcpServer({
    name: "pullup",
    version: "1.0.0",
    tools: specs.map((t) => tool(t.name, t.description, t.shape, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await t.run(args as Record<string, unknown>)) }] }))),
  });
  const deps: WorkflowDeps = { runNode: runNode ?? claudeRunNode(session, env, server, toolNames) };
  const workflow = workflowFor(agentPrompt(), toolNames);
  const result = await runWorkflow(workflow, {}, deps);
  if (result.status === "escalated") throw new EscalationSignal(result.escalation);
}
