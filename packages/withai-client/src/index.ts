import type { z } from "zod";
import type {
  ApplyInput,
  CreateQuestionInput,
  CreateSkillInput,
  CreateRunInput,
  CreateScenarioInput,
  listRunsQuerySchema,
} from "./schemas";
import type { ApiErrorBody, ApplyResult, PersonQuestion, Run, RunEvent, Scenario, SkillDocument, SkillLabelGroup } from "./types";

export * from "./types";
export * from "./webhooks";
export type { AnswerShapeInput, ApplyInput, CreateQuestionInput, CreateRunInput, CreateScenarioInput, CreateSkillInput, SeatInput } from "./schemas";

/** A non-2xx response from WithAI, with the server's error body. */
export class WithAIError extends Error {
  readonly status: number;
  readonly body: Partial<ApiErrorBody>;

  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message || body.statusMessage || `WithAI request failed (${status})`);
    this.name = "WithAIError";
    this.status = status;
    this.body = body;
  }

  /** The token is over its daily limit (HTTP 429). */
  get isLimit(): boolean {
    return this.status === 429;
  }
}

export interface WithAIClientOptions {
  /** Your WithAI address, e.g. https://askwith.ai */
  baseUrl: string;
  /** A workspace API token (`wai_…`). */
  token: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /** Makes a create call safe to retry: the same key never creates twice. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * A typed client for WithAI's public API (`/api/v1`).
 *
 * ```ts
 * const withai = new WithAIClient({ baseUrl: "https://askwith.ai", token: process.env.WITHAI_TOKEN! });
 * const { scenario, run } = await withai.createScenario({ title, seats, answer, start: true });
 * for await (const event of withai.runEvents(run!.id)) console.log(event.type);
 * ```
 */
export class WithAIClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WithAIClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : undefined;
    if (!response.ok) throw new WithAIError(response.status, (parsed ?? {}) as Partial<ApiErrorBody>);
    return parsed as T;
  }

  // ── Scenarios ──────────────────────────────────────────────────────────────

  createScenario(input: CreateScenarioInput, options?: RequestOptions) {
    return this.request<{ scenario: Scenario; run: Run | null }>("POST", "/api/v1/scenarios", input, options);
  }

  async getScenario(id: string): Promise<Scenario> {
    return (await this.request<{ scenario: Scenario }>("GET", `/api/v1/scenarios/${id}`)).scenario;
  }

  async deleteScenario(id: string): Promise<void> {
    await this.request("DELETE", `/api/v1/scenarios/${id}`);
  }

  // ── Runs ───────────────────────────────────────────────────────────────────

  async startRun(input: CreateRunInput, options?: RequestOptions): Promise<Run> {
    return (await this.request<{ run: Run }>("POST", "/api/v1/runs", input, options)).run;
  }

  async getRun(id: string): Promise<Run> {
    return (await this.request<{ run: Run }>("GET", `/api/v1/runs/${id}`)).run;
  }

  async listRuns(query: z.input<typeof listRunsQuerySchema> = {}): Promise<Run[]> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    const qs = params.toString();
    return (await this.request<{ runs: Run[] }>("GET", `/api/v1/runs${qs ? `?${qs}` : ""}`)).runs;
  }

  async cancelRun(id: string): Promise<Run> {
    return (await this.request<{ run: Run }>("POST", `/api/v1/runs/${id}/cancel`)).run;
  }

  async deleteRun(id: string): Promise<void> {
    await this.request("DELETE", `/api/v1/runs/${id}`);
  }

  /**
   * Follow a run's events until its final event (`run.done`, `run.failed` or
   * `run.cancelled`). A dropped connection is reopened from the last event
   * received, so no event is missed or repeated.
   */
  async *runEvents(runId: string, options: { after?: number; signal?: AbortSignal; maxReconnects?: number } = {}): AsyncGenerator<RunEvent> {
    let lastId: string | undefined = options.after !== undefined ? `${runId}:${options.after}` : undefined;
    let reconnects = 0;
    const maxReconnects = options.maxReconnects ?? 20;
    for (;;) {
      let finished = false;
      let received = 0;
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/api/v1/runs/${runId}/events`, {
          headers: { authorization: `Bearer ${this.token}`, accept: "text/event-stream", ...(lastId ? { "last-event-id": lastId } : {}) },
          signal: options.signal,
        });
        if (!response.ok || !response.body) {
          const text = await response.text();
          throw new WithAIError(response.status, text ? (JSON.parse(text) as Partial<ApiErrorBody>) : {});
        }
        for await (const message of readServerSentEvents(response.body)) {
          if (message.event === "error") throw new Error(String((JSON.parse(message.data) as { message?: string }).message));
          if (!message.data) continue;
          const event = JSON.parse(message.data) as RunEvent;
          lastId = event.id;
          received += 1;
          reconnects = 0;
          yield event;
          if (event.type === "run.done" || event.type === "run.failed" || event.type === "run.cancelled") finished = true;
        }
      } catch (error) {
        if (error instanceof WithAIError || options.signal?.aborted) throw error;
        if (++reconnects > maxReconnects) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * reconnects, 10_000)));
      }
      if (finished || options.signal?.aborted) return;
      // The server closes long streams on purpose; resume from the last event.
      // A stream that brought nothing on an ended run means there is nothing left.
      if (!received) {
        const run = await this.getRun(runId);
        if (run.status === "done" || run.status === "failed" || run.status === "cancelled") return;
      }
    }
  }

  /** Wait for a run to end (following its event stream) and return it. */
  async waitForRun(runId: string, options: { signal?: AbortSignal; onEvent?: (event: RunEvent) => void } = {}): Promise<Run> {
    for await (const event of this.runEvents(runId, { signal: options.signal })) options.onEvent?.(event);
    return this.getRun(runId);
  }

  // ── Skills ─────────────────────────────────────────────────────────────────

  /** A skill's active version, or a given version number. */
  /** Create a starter skill from a template, owned by the workspace owner. Returns the existing one if it is already there. */
  async createSkill(input: CreateSkillInput): Promise<{ skill: SkillDocument; created: boolean }> {
    return this.request<{ skill: SkillDocument; created: boolean }>("POST", "/api/v1/skills", input);
  }

  async getSkill(idOrSlug: string, version?: number): Promise<SkillDocument> {
    const qs = version ? `?version=${version}` : "";
    return (await this.request<{ skill: SkillDocument }>("GET", `/api/v1/skills/${encodeURIComponent(idOrSlug)}${qs}`)).skill;
  }

  /** Human-voice answers from the skill's scenarios. Panel answers are never included. */
  async listSkillLabels(idOrSlug: string): Promise<SkillLabelGroup[]> {
    return (await this.request<{ labels: SkillLabelGroup[] }>("GET", `/api/v1/skills/${encodeURIComponent(idOrSlug)}/labels`)).labels;
  }

  // ── Apply ──────────────────────────────────────────────────────────────────

  apply(input: ApplyInput, options?: RequestOptions): Promise<ApplyResult> {
    return this.request<ApplyResult>("POST", "/api/v1/apply", input, options);
  }

  // ── Ask a person ───────────────────────────────────────────────────────────

  async askPerson(input: CreateQuestionInput, options?: RequestOptions): Promise<PersonQuestion> {
    return (await this.request<{ question: PersonQuestion }>("POST", "/api/v1/questions", input, options)).question;
  }

  async getQuestion(id: string): Promise<PersonQuestion> {
    return (await this.request<{ question: PersonQuestion }>("GET", `/api/v1/questions/${id}`)).question;
  }

  async cancelQuestion(id: string): Promise<PersonQuestion> {
    return (await this.request<{ question: PersonQuestion }>("POST", `/api/v1/questions/${id}/cancel`)).question;
  }
}

/** One server-sent event: its id, event name and data lines joined. */
export interface ServerSentEvent {
  id?: string;
  event?: string;
  data: string;
}

/** Parse a `text/event-stream` body into events (comments and `retry:` lines are skipped). */
export async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let current: { id?: string; event?: string; data: string[] } = { data: [] };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line === "") {
        if (current.data.length || current.event) yield { id: current.id, event: current.event, data: current.data.join("\n") };
        current = { data: [] };
      } else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const val = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "data") current.data.push(val);
        else if (field === "event") current.event = val;
        else if (field === "id") current.id = val;
      }
      newline = buffer.indexOf("\n");
    }
  }
}
