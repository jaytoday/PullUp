import type { Assessment } from "@pullup/engine";

/** What a provider answered for one concern, before PullUp checks the quotes. */
export type ProviderAnswer = Omit<Assessment, "concern" | "verified"> & {
  /** A fact the decision is waiting for (AskWithAI only). */
  inputRequest?: { field: string; question: string; expectedVersion: number } | null;
};

export interface DecideOptions {
  /** Groups every decision for one commit (PullUp uses the head commit). */
  traceId: string;
  /** Idempotency: the same run and concern never make two decisions. */
  requestId: string;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
}

/** The one question PullUp asks, in the words both baseline providers send. */
export const MERGE_RISK = {
  instructions: "Is this change risky to merge, given the concern and its evidence?",
  risky: "The concern points at a real problem that a reviewer should block or look at before merging.",
  safe: "The concern is explained by something harmless (the test environment, a removed feature, logging or an easily undone change).",
};

export const failed = (provider: string, error: string): ProviderAnswer => ({ provider, status: "failed", answer: null, final: false, probability: null, citations: [], synthetic: false, decisionId: null, costUsd: null, answeredBy: null, error });

/** AskWithAI's compatible endpoints add a decision id and a small block that provider clients ignore; read it when present. */
export function askwithaiExtras(res: Response, body: { askwithai?: { decision_id?: string; synthetic?: boolean; cost_usd?: number | null } }) {
  return { decisionId: res.headers.get("askwithai-decision-id") ?? body.askwithai?.decision_id ?? null, synthetic: body.askwithai?.synthetic === true, costUsd: body.askwithai?.cost_usd ?? null };
}
