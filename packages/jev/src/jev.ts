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
  /**
   * Any System One server (`POST <baseUrl>/v1/systemone`) instead of
   * TypeSafe's API: Ollama, llama.cpp, OpenCode Zen. The model id PullUp
   * caches and calibrates under then names the server too (`model@host`), so
   * answers and calibration from different servers never mix.
   */
  readonly baseUrl?: string;
  /** How the unit is sent: a JSON object (TypeSafe) or one text block (what Gallant sends; the safe choice for other servers). */
  readonly stateFormat?: "object" | "text";
  readonly client?: SystemOneClient;
  readonly concurrency?: number;
  readonly requestsPerMinute?: number;
  readonly timeoutMs?: number;
  /** Called for every failed unit (default: stderr). */
  readonly onError?: (unit: SignalUnit, err: unknown) => void;
}

/** Ids a System One server is known to accept as question names: letters, digits and underscore. */
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * The id each question is sent under. Plain ids (the built-in questions,
 * lint rules' `r_…` ids) go as they are; anything else (custom questions'
 * `custom:<slug>`) is sent as a positional `q<n>`, as Gallant does, because
 * servers may reject characters such as `:` or `/`. Only the wire name
 * changes: cache keys and calibration use PullUp's own ids.
 */
export function wireIds(qs: QuestionSet): Map<string, string> {
  const ids = Object.keys(qs.questions);
  const taken = new Set(ids.filter((id) => SAFE_ID.test(id)));
  const out = new Map<string, string>();
  let n = 0;
  for (const id of ids) {
    if (SAFE_ID.test(id)) {
      out.set(id, id);
      continue;
    }
    let wire = `q${n++}`;
    while (taken.has(wire)) wire = `q${n++}`;
    taken.add(wire);
    out.set(id, wire);
  }
  return out;
}

/** QuestionSet → SDK questions (Noul / Choice / Score builders), keyed by wire id. */
export function toSdkQuestions(qs: QuestionSet, ids: ReadonlyMap<string, string> = wireIds(qs)): Questions {
  const out: Record<string, Question> = {};
  for (const [internal, spec] of Object.entries(qs.questions)) {
    const id = ids.get(internal) ?? internal;
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
  private readonly model: string;
  private readonly stateFormat: "object" | "text";
  /** `@host` for a non-TypeSafe server, so reported ids compare with `id`. */
  private readonly serverSuffix: string;

  constructor(opts: JevModelOptions = {}) {
    this.model = opts.model ?? "jev-1.13.0";
    this.serverSuffix = opts.baseUrl ? `@${new URL(opts.baseUrl).host}` : "";
    this.id = `${this.model}${this.serverSuffix}`;
    this.stateFormat = opts.stateFormat ?? "object";
    this.client =
      opts.client ??
      new TypeSafeClient({
        // The SDK insists on a key; a local server ignores the placeholder.
        ...(opts.apiKey ? { apiKey: opts.apiKey } : opts.baseUrl ? { apiKey: "none" } : {}),
        ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
        defaultModel: this.model,
        timeout: opts.timeoutMs ?? 10_000,
      });
    this.concurrency = opts.concurrency ?? 8;
    this.spacingMs = 60_000 / (opts.requestsPerMinute ?? 1200);
    this.onError =
      opts.onError ??
      ((unit, err) => console.error(`[jev] unit ${unit.key} failed: ${(err as Error).message}`));
  }

  async evaluate(units: readonly SignalUnit[], qs: QuestionSet): Promise<Array<UnitAnswers | null>> {
    const ids = wireIds(qs);
    const questions = toSdkQuestions(qs, ids);
    const results = new Array<UnitAnswers | null>(units.length).fill(null);
    let cursor = 0;
    const worker = async () => {
      while (cursor < units.length) {
        const i = cursor++;
        results[i] = await this.one(units[i]!, questions, ids);
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

  private async one(unit: SignalUnit, questions: Questions, ids: ReadonlyMap<string, string>): Promise<UnitAnswers | null> {
    await this.throttle();
    const t0 = Date.now();
    try {
      // Code-only state: path, area, hunk. Never PR body/commits/comments.
      const { path, area, hunk } = unit.state;
      const res = await this.client.systemOne({
        model: this.model,
        state: this.stateFormat === "text" ? `File: ${path}\nArea: ${area}\n\n${hunk}` : { path, area, hunk },
        questions,
      });
      const answers: Record<string, Answer> = {};
      for (const [internal, wire] of ids) {
        const a = toAnswer(res.answers[wire]);
        if (!a) throw new Error(`missing/unknown answer for question ${internal}`);
        answers[internal] = a;
      }
      return {
        answers,
        modelId: `${res.model}${this.serverSuffix}`,
        inputTokens: res.usage.input_tokens,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      this.onError(unit, err);
      return null;
    }
  }
}
