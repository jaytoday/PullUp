export interface DecisionCitation { quote: string; source?: string; locator?: string }
export interface Decision {
  id: string;
  object: "decision";
  runtime: string;
  version: number;
  status: "decided" | "pending_review" | "failed";
  decisions: Record<string, { answer: string | null; final: boolean; answeredBy: string; probability: number | null }>;
  reviews?: Array<{ reviewId: string; question: string; deadlineAt: string; onTimeout: string }>;
  costUsd: number;
  latencyMs: number;
  synthetic: boolean;
  receipt: { questions: Record<string, { reason: string; citations: DecisionCitation[]; warnings: string[] }>; [key: string]: unknown };
}

export class AskWithAIError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export class AskWithAI {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }) {
    this.baseUrl = (options.baseUrl ?? "https://api.askwith.ai").replace(/\/+$/, "");
    this.fetcher = options.fetch ?? fetch;
  }
  private async request<T>(path: string, body: unknown, idempotencyKey: string, signal?: AbortSignal): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as Record<string, unknown> : {};
    if (!response.ok) {
      const error = data.error as { code?: string; message?: string } | undefined;
      throw new AskWithAIError(response.status, error?.code ?? "http_error", error?.message ?? `AskWithAI returned HTTP ${response.status}`);
    }
    return data as T;
  }
  decide(runtime: string, input: Record<string, unknown>, options: { version?: number; requestId: string; traceId: string; stepName: string; idempotencyKey: string; signal?: AbortSignal }): Promise<Decision> {
    return this.request(`/v1/decide/${runtime}`, { input, version: options.version, requestId: options.requestId, traceId: options.traceId, stepName: options.stepName }, options.idempotencyKey, options.signal);
  }
  reportOutcome(decisionId: string, labels: Record<string, string>, key: string): Promise<unknown> {
    return this.request(`/v1/decisions/${encodeURIComponent(decisionId)}/outcome`, { labels, key }, key);
  }
}
