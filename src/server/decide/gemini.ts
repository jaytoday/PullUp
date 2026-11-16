import type { AssessInput } from "@pullup/engine";
import { askwithaiExtras, type DecideOptions, failed, MERGE_RISK, type ProviderAnswer } from "./types";

/**
 * The other baseline: the Gemini Decisions API called directly. The swap to
 * AskWithAI changes GEMINI_DECISIONS_BASE_URL and GEMINI_API_KEY only.
 */
export async function askGemini(input: AssessInput, o: DecideOptions): Promise<ProviderAnswer> {
  const env = o.env ?? process.env;
  const base = (env.GEMINI_DECISIONS_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  try {
    const res = await (o.fetch ?? fetch)(`${base}/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        model: env.GEMINI_DECISIONS_MODEL ?? "gemini-decision-1",
        // The Decisions API takes the input as text.
        input: JSON.stringify(input),
        questions: { q0: { type: "noul", instructions: MERGE_RISK.instructions, criteria: { true_description: MERGE_RISK.risky, false_description: MERGE_RISK.safe } } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { answers?: { q0?: { noul?: number } }; error?: { message?: string }; askwithai?: { decision_id?: string; synthetic?: boolean; cost_usd?: number | null } };
    if (!res.ok || body.error) return failed("gemini", `Gemini Decisions answered ${res.status}: ${body.error?.message ?? ""}`.trim());
    const p = body.answers?.q0?.noul;
    if (typeof p !== "number") return failed("gemini", "no probability in the answer");
    return { provider: "gemini", status: "decided", answer: p >= 0.5 ? "risky" : "safe", final: true, probability: p, citations: [], answeredBy: "gemini", error: null, ...askwithaiExtras(res, body) };
  } catch (e) {
    return failed("gemini", (e as Error).message);
  }
}
