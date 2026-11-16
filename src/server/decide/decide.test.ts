import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { askMergeRisk, deciderOf } from "./index";
import { MERGE_RISK } from "./types";

/*
 * The three providers behind `assess`. The two baselines are checked against
 * recorded responses in each provider's wire format; the question PullUp
 * sends must match the runtime's, or AskWithAI's compatible endpoints refuse it.
 */

const input = { concern: "sensitive_change" as const, repository: "acme/shop", headSha: "abc", title: "t", body: "", evidence: [{ source: "diff" as const, where: "src/auth/session.ts:1", text: "const TTL = 86400 * 30;" }], blastRadius: 2, diffTruncated: false };

function recorded(body: unknown, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

describe("providers", () => {
  it("Jev: System One request with a noul question; p(true) is p(risky)", async () => {
    const r = recorded({ model: "jev-1.13.0", answers: { q0: { type: "noul", noul: 0.82 } }, usage: { input_tokens: 300, output_tokens: 1 } });
    const a = await askMergeRisk(input, { traceId: "abc", requestId: "r1", fetch: r.fetch, env: { PULLUP_DECIDER: "jev", JEV_API_KEY: "k", JEV_BASE_URL: "https://jev.test" } });
    expect(a).toMatchObject({ provider: "jev", answer: "risky", probability: 0.82, final: true, decisionId: null, synthetic: false });
    expect(r.calls[0]!.url).toBe("https://jev.test/v1/systemone");
    const sent = JSON.parse(String(r.calls[0]!.init.body));
    expect(sent).toMatchObject({ model: "jev-1.13.0", state: input, questions: { q0: { type: "noul", instructions: MERGE_RISK.instructions } } });
  });

  it("Gemini: Decisions request with the input as text; reads AskWithAI's decision id when the base address points at it", async () => {
    const r = recorded({ answers: { q0: { noul: 0.1 } } }, { "AskWithAI-Decision-Id": "dec_9" });
    const a = await askMergeRisk(input, { traceId: "abc", requestId: "r1", fetch: r.fetch, env: { PULLUP_DECIDER: "gemini", GEMINI_API_KEY: "g", GEMINI_DECISIONS_BASE_URL: "https://askwith.test/v1/runtimes/acme/ci-review/gemini" } });
    expect(a).toMatchObject({ provider: "gemini", answer: "safe", decisionId: "dec_9" });
    expect(r.calls[0]!.url).toBe("https://askwith.test/v1/runtimes/acme/ci-review/gemini/decisions");
    expect(JSON.parse(String(r.calls[0]!.init.body)).input).toBe(JSON.stringify(input));
    expect(new Headers(r.calls[0]!.init.headers).get("x-goog-api-key")).toBe("g");
  });

  it("errors become failed assessments, never answers", async () => {
    const down = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    for (const d of ["jev", "gemini", "askwithai"]) {
      const a = await askMergeRisk(input, { traceId: "abc", requestId: "r1", fetch: down, env: { PULLUP_DECIDER: d, ASKWITHAI_API_KEY: "wai_x", PULLUP_RUNTIME: "acme/ci-review" } });
      expect(a).toMatchObject({ status: "failed", answer: null });
    }
    expect(await askMergeRisk(input, { traceId: "a", requestId: "r", env: { PULLUP_DECIDER: "askwithai" } })).toMatchObject({ status: "failed", error: /ASKWITHAI_API_KEY/ });
    expect(deciderOf({ PULLUP_DECIDER: "nope" })).toBe("askwithai");
  });

  it("the question and input PullUp sends match askwithai/runtime.yaml", () => {
    const spec = (parse(readFileSync("askwithai/runtime.yaml", "utf8")) as { spec: { questions: Array<{ prompt: string; labels: string[] }>; inputSchema: { properties: Record<string, unknown>; required: string[] } } }).spec;
    expect(spec.questions[0]).toMatchObject({ prompt: MERGE_RISK.instructions, labels: ["risky", "safe"] });
    for (const k of Object.keys(input)) expect(spec.inputSchema.properties).toHaveProperty(k);
    for (const k of spec.inputSchema.required) expect(input).toHaveProperty(k);
  });
});
