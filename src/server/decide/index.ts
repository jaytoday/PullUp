import type { AssessInput } from "@pullup/engine";
import { askAskWithAI } from "./askwithai";
import { askGemini } from "./gemini";
import { askJev } from "./jev";
import type { DecideOptions, ProviderAnswer } from "./types";

export type { DecideOptions, ProviderAnswer } from "./types";

export const DECIDERS = ["jev", "gemini", "askwithai"] as const;
export type Decider = (typeof DECIDERS)[number];

export function deciderOf(env: Record<string, string | undefined> = process.env): Decider {
  const v = env.PULLUP_DECIDER?.trim();
  return (DECIDERS as readonly string[]).includes(v ?? "") ? (v as Decider) : "askwithai";
}

/**
 * The one decision call behind the agent's `assess` tool. `PULLUP_DECIDER`
 * picks the provider; swapping it is a configuration change.
 */
export function askMergeRisk(input: AssessInput, o: DecideOptions): Promise<ProviderAnswer> {
  const d = deciderOf(o.env);
  return d === "jev" ? askJev(input, o) : d === "gemini" ? askGemini(input, o) : askAskWithAI(input, o);
}
