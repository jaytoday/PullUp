import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, type LanguageModel, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { AgentSession } from "./tools";

export const MAX_STEPS = 12;
export const MAX_OUTPUT_TOKENS = 4000;

export const agentPrompt = () => readFileSync(join(process.cwd(), "src/server/agent/prompt.md"), "utf8");

/** The default harness: a Vercel AI SDK tool loop on a cheap model, capped at 12 steps. */
export async function runAiSdk(session: AgentSession, env: Record<string, string | undefined> = process.env, model?: LanguageModel): Promise<void> {
  model ??= createAnthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL })(env.AGENT_MODEL ?? "claude-haiku-4-5");
  const tools = Object.fromEntries(session.tools().map((t) => [t.name, tool({ description: t.description, inputSchema: z.object(t.shape), execute: async (args) => t.run(args as Record<string, unknown>) })]));
  await generateText({
    model,
    system: agentPrompt(),
    prompt: `Review CI for ${session.ctx.run.repo} at ${session.ctx.run.headSha}. Start with get_ci_summary.`,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(120_000),
  });
}
