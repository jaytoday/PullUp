// Live Jev SignalModel over the TypeSafe SDK. One `systemOne` call per unit
// asks the whole question set in parallel (Jev's "ask everything at once"
// discipline). The SDK retries 408/429/5xx (incl. 529 overloaded) with
// backoff; this adapter adds a start-rate limiter (requests/minute) and a
// concurrency cap. A failed unit returns null — aggregation treats it as
// unknown risk, never as low risk.

import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Question, Questions, SystemOneRequest } from "@typesafe-ai/sdk";
import type {
  Answer,
  QuestionSet,
  SignalModel,
  SignalUnit,
  UnitAnswers,
} from "@pullup/core";

/** The slice of TypeSafeClient we use — lets tests inject a fake. */
export interface SystemOneClient {
  systemOne(request: SystemOneRequest<Questions>): PromiseLike<{
    readonly model: string;
    readonly answers: Readonly<Record<string, unknown>>;
    readonly usage: { readonly input_tokens: number };
  }>;
}

export interface JevModelOptions {
  /** Pinned model id (default "jev-1.13.0"). Never "jev-latest" in production. */
  readonly model?: string;
  readonly apiKey?: string;
  readonly client?: SystemOneClient;
  readonly concurrency?: number;
  readonly requestsPerMinute?: number;
  readonly timeoutMs?: number;
  /** Called for every failed unit (default: stderr). */
  readonly onError?: (unit: SignalUnit, err: unknown) => void;
}

/** QuestionSet → SDK questions (Noul / Choice / Score builders). */
export function toSdkQuestions(qs: QuestionSet): Questions {
  const out: Record<string, Question> = {};
  for (const [id, spec] of Object.entries(qs.questions)) {
    if (spec.kind === "noul") {
      out[id] = noul(spec.text, spec.criteria ?? null);
    } else if (spec.kind === "choice") {
      out[id] = choice(spec.text, { ...spec.options });
    } else {
      const [a, b, ...rest] = spec.levels;
      out[id] = score(spec.text, [a!, b!, ...rest]);
    }
  }
  return out;
}

function toAnswer(raw: unknown): Answer | null {
  const r = raw as { type?: string } & Record<string, unknown>;
  switch (r?.type) {
    case "noul":
      return { kind: "noul", p: Number(r.noul) };
    case "choice":
      return {
        kind: "choice",
        choice: String(r.choice),
        confidence: Number(r.confidence),
        probabilities: r.probabilities as Record<string, number>,
      };
    case "score":
      return {
        kind: "score",
        score: Number(r.score),
        confidence: Number(r.confidence),
        probabilities: r.probabilities as Record<string, number>,
      };
    default:
      return null;
  }
}

export class JevSignalModel implements SignalModel {
  readonly id: string;
  private readonly client: SystemOneClient;
  private readonly concurrency: number;
  private readonly spacingMs: number;
  private readonly onError: (unit: SignalUnit, err: unknown) => void;
  private nextStart = 0;

  constructor(opts: JevModelOptions = {}) {
    this.id = opts.model ?? "jev-1.13.0";
    this.client =
      opts.client ??
      new TypeSafeClient({
        ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
        defaultModel: this.id,
        timeout: opts.timeoutMs ?? 10_000,
      });
    this.concurrency = opts.concurrency ?? 8;
    this.spacingMs = 60_000 / (opts.requestsPerMinute ?? 1200);
    this.onError =
      opts.onError ??
      ((unit, err) => console.error(`[jev] unit ${unit.key} failed: ${(err as Error).message}`));
  }

  async evaluate(units: readonly SignalUnit[], qs: QuestionSet): Promise<Array<UnitAnswers | null>> {
    const questions = toSdkQuestions(qs);
    const results = new Array<UnitAnswers | null>(units.length).fill(null);
    let cursor = 0;
    const worker = async () => {
      while (cursor < units.length) {
        const i = cursor++;
        results[i] = await this.one(units[i]!, questions);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, units.length) }, worker));
    return results;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const start = Math.max(now, this.nextStart);
    this.nextStart = start + this.spacingMs;
    if (start > now) await new Promise((r) => setTimeout(r, start - now));
  }

  private async one(unit: SignalUnit, questions: Questions): Promise<UnitAnswers | null> {
    await this.throttle();
    const t0 = Date.now();
    try {
      const res = await this.client.systemOne({
        model: this.id,
        // Code-only state: path, area, hunk. Never PR body/commits/comments.
        state: { path: unit.state.path, area: unit.state.area, hunk: unit.state.hunk },
        questions,
      });
      const answers: Record<string, Answer> = {};
      for (const id of Object.keys(questions)) {
        const a = toAnswer(res.answers[id]);
        if (!a) throw new Error(`missing/unknown answer for question ${id}`);
        answers[id] = a;
      }
      return {
        answers,
        modelId: res.model,
        inputTokens: res.usage.input_tokens,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      this.onError(unit, err);
      return null;
    }
  }
}
