import type { LanguageModel } from "ai";
import { runAgentRunWorkflow } from "./agentrun";
import { runAiSdk } from "./ai-sdk";
import { runClaudeAgent } from "./claude-agent";
import { runScripted } from "./scripted";
import { type AgentContext, AgentSession } from "./tools";
import { failed } from "../decide/types";

export { AgentSession, type AgentContext, type AgentStep, repositoryFact } from "./tools";

export type Harness = "ai-sdk" | "claude-agent" | "agentrun" | "scripted";

/** The scripted planner unless a harness is chosen and a model key is set; demo mode is always scripted. */
export function harnessOf(env: Record<string, string | undefined> = process.env): Harness {
  if (env.PULLUP_DEMO === "1" || !env.ANTHROPIC_API_KEY) return "scripted";
  if (env.AGENT_HARNESS === "claude-agent") return "claude-agent";
  if (env.AGENT_HARNESS === "agentrun") return "agentrun";
  if (env.AGENT_HARNESS === "scripted") return "scripted";
  return "ai-sdk";
}

/**
 * Run the agent over the flagged concerns. Whatever happens, every concern
 * ends with an assessment: one the agent never made, or a loop that failed,
 * becomes a "failed" assessment, which the policy sends to a person.
 */
export async function runAgent(ctx: AgentContext, env: Record<string, string | undefined> = process.env, model?: LanguageModel) {
  const session = new AgentSession(ctx);
  const harness = harnessOf(env);
  let error: string | null = null;
  try {
    if (harness === "scripted") await runScripted(session);
    else if (harness === "claude-agent") await runClaudeAgent(session, env);
    else if (harness === "agentrun") await runAgentRunWorkflow(session, env);
    else await runAiSdk(session, env, model);
  } catch (e) {
    error = (e as Error).message;
  }
  for (const c of ctx.concerns) {
    if (!session.answers.has(c.concern)) session.answers.set(c.concern, failed("agent", error ? `the agent stopped: ${error}` : "the agent did not assess this concern"));
  }
  return { harness, steps: session.steps, answers: session.answers, error };
}
