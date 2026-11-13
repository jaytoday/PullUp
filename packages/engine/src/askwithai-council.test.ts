import { fileURLToPath } from "node:url";
import { AskWithAI } from "@askwithai/client";
import { describe, expect, it } from "vitest";
import { loadFixtures } from "./fixtures";
import { ASK_WITH_AI_SEAT, askWithAICouncil } from "./askwithai-council";
import { decideRun } from "./resolution";

const fixture = loadFixtures(fileURLToPath(new URL("../../../fixtures", import.meta.url))).find((f) => f.name === "weakened-skip")!;

describe("AskWithAI council adapter", () => {
  it("submits one replay-safe runtime decision and maps its cited answer to PullUp's verifier", async () => {
    const sent: Array<{ url: string; init?: RequestInit }> = [];
    const client = new AskWithAI({ apiKey: "test", baseUrl: "https://ask.test", fetch: async (url, init) => {
      sent.push({ url: String(url), init });
      return Response.json({
        id: "decision-1", object: "decision", runtime: "owner/review", version: 3, status: "decided",
        decisions: { review: { answer: "fail", final: true, answeredBy: "council", probability: 0.9 } },
        costUsd: 0.02, latencyMs: 800, synthetic: false,
        receipt: { questions: { review: { reason: "A changed line is unsafe.", citations: [{ quote: "console.log(total);", source: "diff" }], warnings: [] } } },
      });
    } });
    const question = { id: "core:test", extension: "core", key: "test", prompt: "Is this safe?", summary: "Review", evidence: [], councilMayPass: true, shadow: false };
    const raw = await askWithAICouncil({ client, runtime: "owner/review", version: 3, answerKey: "review" })(question, fixture.run, fixture.config.council.seats);
    expect(raw).toMatchObject([{ seat: ASK_WITH_AI_SEAT, answer: { verdict: "fail", strength: 4, quotes: [{ source: "diff", text: "console.log(total);" }] }, platformDecision: { id: "decision-1", version: 3, requestId: `${fixture.run.repo}:${fixture.run.headSha}:core:test` } }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://ask.test/v1/decide/owner/review");
    expect(sent[0]!.init?.headers).toMatchObject({ "idempotency-key": expect.any(String) });
    expect(JSON.parse(String(sent[0]!.init?.body))).toMatchObject({ version: 3, traceId: `${fixture.run.repo}:${fixture.run.headSha}`, stepName: "core:core:test", input: { viewpoints: fixture.config.council.seats } });
  });

  it("routes synthetic or pending decisions to PullUp's person-needed path", async () => {
    const client = new AskWithAI({ apiKey: "test", fetch: async () => Response.json({ id: "d", object: "decision", runtime: "owner/review", version: 1, status: "pending_review", decisions: {}, costUsd: 0, latencyMs: 1, synthetic: false, receipt: { questions: {} } }) });
    const question = { id: "core:test", extension: "core", key: "test", prompt: "q", summary: "s", evidence: [], councilMayPass: true, shadow: false };
    const raw = await askWithAICouncil({ client, runtime: "owner/review" })(question, fixture.run, []);
    expect(raw[0]).toMatchObject({ answer: null, platformDecision: { id: "d", status: "pending_review" } });
  });

  it("uses the existing deterministic resolver and its quote checks on runtime answers", async () => {
    const client = new AskWithAI({ apiKey: "test", fetch: async () => Response.json({
      id: "d", object: "decision", runtime: "owner/review", version: 1, status: "decided",
      decisions: { review: { answer: "fail", final: true, answeredBy: "council", probability: 1 } }, costUsd: 0, latencyMs: 1, synthetic: false,
      receipt: { questions: { review: { reason: "unsafe", citations: [{ quote: "not in the diff", source: "diff" }], warnings: [] } } },
    }) });
    const council = askWithAICouncil({ client, runtime: "owner/review", answerKey: "review" });
    const result = await decideRun(fixture.run, fixture.config, council);
    expect(result.questions[0]!.seats).toHaveLength(1);
    expect(result.questions[0]!.outcome).toBe("ask");
    expect(result.councilCalls).toBe(1);
  });
});
