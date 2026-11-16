import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { agentPrompt, MAX_STEPS } from "./ai-sdk";
import type { AgentSession } from "./tools";

/**
 * The same agent on the Claude Agent SDK (`AGENT_HARNESS=claude-agent`).
 * PullUp's tools are served as an in-process MCP server; the agent gets no
 * other tools (no shell, no file edits), and the same 12-turn cap.
 */
export async function runClaudeAgent(session: AgentSession, env: Record<string, string | undefined> = process.env): Promise<void> {
  const specs = session.tools();
  const server = createSdkMcpServer({
    name: "pullup",
    version: "1.0.0",
    tools: specs.map((t) => tool(t.name, t.description, t.shape, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await t.run(args as Record<string, unknown>)) }] }))),
  });
  const stream = query({
    prompt: `Review CI for ${session.ctx.run.repo} at ${session.ctx.run.headSha}. Start with get_ci_summary.`,
    options: {
      systemPrompt: agentPrompt(),
      model: env.AGENT_MODEL ?? "claude-haiku-4-5",
      mcpServers: { pullup: server },
      tools: [],
      allowedTools: specs.map((t) => `mcp__pullup__${t.name}`),
      maxTurns: MAX_STEPS,
    },
  });
  for await (const message of stream) {
    if (message.type === "result") break;
  }
}
