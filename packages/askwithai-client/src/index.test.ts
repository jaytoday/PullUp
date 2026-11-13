import { describe, expect, it } from "vitest";
import { AskWithAI } from "./index";

describe("AskWithAI Decision API client", () => {
  it("sends the decision request with bearer auth and an idempotency key", async () => {
    let request: RequestInit | undefined;
    const client = new AskWithAI({ apiKey: "test-key", baseUrl: "https://ask.test/", fetch: async (_url, init) => {
      request = init;
      return Response.json({ id: "d1" });
    } });
    await client.decide("owner/review", { headSha: "abc" }, { requestId: "r1", traceId: "t1", stepName: "review", idempotencyKey: "stable" });
    expect(request?.headers).toMatchObject({ authorization: "Bearer test-key", "idempotency-key": "stable" });
    expect(JSON.parse(String(request?.body))).toMatchObject({ input: { headSha: "abc" }, requestId: "r1", traceId: "t1", stepName: "review" });
  });

  it("reports API failures with their status and code", async () => {
    const client = new AskWithAI({ apiKey: "test-key", fetch: async () => Response.json({ error: { code: "rate_limited", message: "Slow down" } }, { status: 429 }) });
    await expect(client.decide("owner/review", {}, { requestId: "r1", traceId: "t1", stepName: "review", idempotencyKey: "stable" })).rejects.toMatchObject({ status: 429, code: "rate_limited", message: "Slow down" });
  });
});
