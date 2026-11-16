import type { AssessInput } from "@pullup/engine";
import { askwithaiExtras, type DecideOptions, failed, MERGE_RISK, type ProviderAnswer } from "./types";

/**
 * The "before" picture: PullUp calling Jev (TypeSafe's System One API)
 * directly. Adopting AskWithAI's first step changes only JEV_BASE_URL and
 * JEV_API_KEY to point at the runtime's compatible endpoint.
 */
export async function askJev(input: AssessInput, o: DecideOptions): Promise<ProviderAnswer> {
  const env = o.env ?? process.env;
  const base = (env.JEV_BASE_URL ?? "https://api.typesafe.ai").replace(/\/+$/, "");
  try {
    const res = await (o.fetch ?? fetch)(`${base}/v1/systemone`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.JEV_API_KEY ?? ""}`, "idempotency-key": o.requestId },
      body: JSON.stringify({
        model: env.JEV_MODEL ?? "jev-1.13.0",
        state: input,
        questions: { q0: { type: "noul", instructions: MERGE_RISK.instructions, criteria: { true: MERGE_RISK.risky, false: MERGE_RISK.safe } } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { answers?: { q0?: { noul?: number } }; askwithai?: { decision_id?: string; synthetic?: boolean; cost_usd?: number | null } };
    if (!res.ok) return failed("jev", `System One answered ${res.status}`);
    const p = body.answers?.q0?.noul;
    if (typeof p !== "number") return failed("jev", "no probability in the answer");
    return { provider: "jev", status: "decided", answer: p >= 0.5 ? "risky" : "safe", final: true, probability: p, citations: [], answeredBy: "jev", error: null, ...askwithaiExtras(res, body) };
  } catch (e) {
    return failed("jev", (e as Error).message);
  }
}
