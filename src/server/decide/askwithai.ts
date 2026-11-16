import type { AssessInput } from "@pullup/engine";
import { AskWithAI, createDecision, type Decision, DecisionNotReadyError } from "@askwithai/sdk";
import { z } from "zod";
import { type DecideOptions, failed, type ProviderAnswer } from "./types";

/**
 * Stage 2 onward: the SDK, with typed answers, traces, person reviews,
 * input requests and outcomes. Serving modes (parity, shadow, active) are
 * switched in AskWithAI, not here.
 */

export function askwithaiClient(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): AskWithAI | null {
  const apiKey = env.ASKWITHAI_API_KEY?.trim();
  return apiKey ? new AskWithAI({ apiKey, baseUrl: env.ASKWITHAI_URL?.trim() || undefined, ...(fetchImpl ? { fetch: fetchImpl } : {}) }) : null;
}

export const runtimeRef = (env: Record<string, string | undefined> = process.env) => env.PULLUP_RUNTIME?.trim() ?? "";

const schema = z.object({ merge_risk: z.enum(["risky", "safe"]) });

/** A decision record as PullUp's assessment. */
export function fromDecision(d: Decision): ProviderAnswer {
  const q = d.decisions.merge_risk;
  const answer = (q?.answer ?? d.provisionalDecision?.merge_risk?.label ?? null) as "risky" | "safe" | null;
  const receipt = (d.receipt as { questions?: Record<string, { citations?: Array<{ quote: string; source?: string }> }> }).questions?.merge_risk;
  const input = d.inputRequests?.[0];
  return {
    provider: "askwithai",
    status: d.status === "running" ? "pending_review" : d.status,
    answer,
    final: d.status === "decided" && !!q?.final,
    probability: q?.probability ?? null,
    citations: receipt?.citations ?? [],
    synthetic: d.synthetic,
    decisionId: d.id,
    costUsd: d.costUsd,
    answeredBy: q?.answeredBy ?? null,
    error: d.status === "failed" ? "the decision failed" : null,
    inputRequest: input ? { field: input.field, question: input.question, expectedVersion: input.expectedVersion } : null,
  };
}

export async function askAskWithAI(input: AssessInput, o: DecideOptions): Promise<ProviderAnswer> {
  const env = o.env ?? process.env;
  const client = askwithaiClient(env, o.fetch);
  const runtime = runtimeRef(env);
  if (!client || !runtime) return failed("askwithai", "ASKWITHAI_API_KEY and PULLUP_RUNTIME are not set");
  // Big sensitive changes always get a second opinion, whatever the fast tier says.
  const decide = createDecision<z.infer<typeof schema>, AssessInput>(client, { runtime, schema, escalateIf: (c) => c.blastRadius > 200 });
  try {
    const r = await decide(input, { traceId: o.traceId, requestId: o.requestId, idempotencyKey: o.requestId, waitForMs: Number(env.PULLUP_DECIDE_WAIT_MS ?? 5000) });
    return r.decision ? fromDecision(r.decision) : failed("askwithai", "no decision record");
  } catch (e) {
    if (e instanceof DecisionNotReadyError) return fromDecision(e.decision);
    return failed("askwithai", (e as Error).message);
  }
}
