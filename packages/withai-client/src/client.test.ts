import { describe, expect, it } from "vitest";
import { WithAIClient, readServerSentEvents, signWebhookBody, verifyWebhookSignature } from "./index";
import { createScenarioSchema, createQuestionSchema } from "./schemas";

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      // Split mid-line to prove the parser buffers across chunks.
      controller.enqueue(bytes.slice(0, 7));
      controller.enqueue(bytes.slice(7));
      controller.close();
    },
  });
}

describe("readServerSentEvents", () => {
  it("parses ids, event names and data, skipping comments", async () => {
    const events = [];
    for await (const e of readServerSentEvents(streamOf("retry: 2000\n\n: keep-alive\n\nid: r:0\nevent: run.started\ndata: {\"a\":1}\n\n"))) events.push(e);
    expect(events).toEqual([{ id: "r:0", event: "run.started", data: '{"a":1}' }]);
  });
});

describe("webhook signatures", () => {
  it("verifies a body it signed, and refuses a changed body or an old timestamp", async () => {
    const header = await signWebhookBody("whsec_x", '{"ok":true}');
    expect(await verifyWebhookSignature("whsec_x", '{"ok":true}', header)).toBe(true);
    expect(await verifyWebhookSignature("whsec_x", '{"ok":false}', header)).toBe(false);
    expect(await verifyWebhookSignature("whsec_y", '{"ok":true}', header)).toBe(false);
    const old = await signWebhookBody("whsec_x", "{}", Math.floor(Date.now() / 1000) - 3600);
    expect(await verifyWebhookSignature("whsec_x", "{}", old)).toBe(false);
  });
});

describe("schemas", () => {
  it("accepts a Read the Room scenario and rejects too few seats", () => {
    const seat = { name: "Ada", role: "Host", viewpoint: "Keep it light" };
    const ok = createScenarioSchema.safeParse({
      title: "Who should host?",
      seats: [seat, seat, seat, seat],
      answer: { type: "choice", question: "Who?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
    });
    expect(ok.success).toBe(true);
    expect(createScenarioSchema.safeParse({ title: "x", seats: [seat, seat] }).success).toBe(false);
  });

  it("needs a deadline for a question", () => {
    expect(createQuestionSchema.safeParse({ prompt: "Approve?", to: { userId: "u1" } }).success).toBe(false);
    expect(createQuestionSchema.safeParse({ prompt: "Approve?", to: { userId: "u1" }, expiresInMinutes: 30 }).success).toBe(true);
  });
});

describe("WithAIClient", () => {
  it("sends the token and idempotency key, and turns error bodies into WithAIError", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ statusCode: 429, statusMessage: "Too Many Requests", message: "Daily limit reached" }), { status: 429 });
    }) as unknown as typeof fetch;
    const client = new WithAIClient({ baseUrl: "https://w.example/", token: "wai_t", fetch: fakeFetch });
    const error = await client.startRun({ scenarioId: "00000000-0000-4000-8000-000000000000" }, { idempotencyKey: "k1" }).catch((e) => e);
    expect(error.isLimit).toBe(true);
    expect(error.message).toBe("Daily limit reached");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe("https://w.example/api/v1/runs");
    expect(headers.authorization).toBe("Bearer wai_t");
    expect(headers["idempotency-key"]).toBe("k1");
  });

  it("follows a run's events across a dropped connection without repeating any", async () => {
    let opened = 0;
    const lastIds: (string | null)[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      opened += 1;
      lastIds.push((init.headers as Record<string, string>)["last-event-id"] ?? null);
      const event = (seq: number, type: string) =>
        `id: r:${seq}\nevent: ${type}\ndata: ${JSON.stringify({ id: `r:${seq}`, type, runId: "r", seq, createdAt: "", data: {} })}\n\n`;
      const body = opened === 1 ? event(0, "run.started") + event(1, "run.progress") : event(2, "run.done");
      return new Response(streamOf(body), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new WithAIClient({ baseUrl: "https://w.example", token: "t", fetch: fakeFetch });
    const types = [];
    for await (const event of client.runEvents("r")) types.push(event.type);
    expect(types).toEqual(["run.started", "run.progress", "run.done"]);
    expect(lastIds).toEqual([null, "r:1"]);
  });
});

describe("outcomes and profiles", () => {
  it("posts an outcome to the run's outcomes and returns it", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new WithAIClient({
      baseUrl: "https://withai.test",
      token: "wai_x",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ outcome: { id: "o1", outcome: "correct" } }), { status: 200 });
      }) as typeof fetch,
    });
    const outcome = await client.recordOutcome("run 1", { outcome: "correct", key: "trade-7" });
    expect(outcome).toMatchObject({ id: "o1" });
    expect(calls[0]!.url).toBe("https://withai.test/api/v1/runs/run%201/outcomes");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ outcome: "correct", key: "trade-7" });
  });

  it("accepts a well-formed profile on apply and rejects a bad name", async () => {
    const { applySchema } = await import("./schemas");
    const base = { request: "Enter?", answer: { type: "verdict", question: "Go?" } };
    expect(applySchema.safeParse({ ...base, profile: { name: "theory-seat", version: 1 } }).success).toBe(true);
    expect(applySchema.safeParse({ ...base, profile: { name: "Theory Seat", version: 1 } }).success).toBe(false);
    expect(applySchema.safeParse({ ...base, profile: { name: "theory-seat", version: 0 } }).success).toBe(false);
  });
});
