// The SignalModel seam: a typed-decision model (Jev, or a deterministic
// stand-in) answers a versioned QuestionSet about each SignalUnit (one diff
// hunk, or one part of an oversized hunk). Core never calls the network — live
// adapters live in `@pullup/jev`.

export interface NoulSpec {
  readonly kind: "noul";
  readonly text: string;
  readonly criteria?: { readonly true: string; readonly false: string };
}

export interface ChoiceSpec {
  readonly kind: "choice";
  readonly text: string;
  readonly options: Readonly<Record<string, string>>;
}

export interface ScoreSpec {
  readonly kind: "score";
  readonly text: string;
  /** Ordered rubric, index 0 = lowest. 2–10 levels. */
  readonly levels: readonly string[];
}

export type QuestionSpec = NoulSpec | ChoiceSpec | ScoreSpec;

export interface QuestionSet {
  readonly version: string;
  readonly questions: Readonly<Record<string, QuestionSpec>>;
  /** Noul ids whose "yes" raises risk (risk features; ≥ medium → review band). */
  readonly sensitive: readonly string[];
  /** Subset of `sensitive` that escalates to a human at ≥ the high threshold. */
  readonly escalating: readonly string[];
  /** Noul ids whose "yes" marks a low-risk change (fast-path evidence). */
  readonly lowRisk: readonly string[];
  /** Noul id of the injection tripwire. */
  readonly injection: string;
  /** Choice id for the change kind, and its low-risk options. */
  readonly changeKind: string;
  readonly lowRiskKinds: readonly string[];
  /** Score id for blast radius. */
  readonly blastRadius: string;
}

export interface NoulAnswer {
  readonly kind: "noul";
  /** P(yes). Jev returns no separate confidence for Noul. */
  readonly p: number;
}

export interface ChoiceAnswer {
  readonly kind: "choice";
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface ScoreAnswer {
  readonly kind: "score";
  /** Expected level index (0-based). */
  readonly score: number;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface UnitAnswers {
  readonly answers: Readonly<Record<string, Answer>>;
  /** Versioned model id reported by the provider (e.g. "jev-1.13.0"). */
  readonly modelId: string;
  readonly inputTokens: number;
  readonly latencyMs: number;
}

/** State handed to the model: code only — never PR body, commits, or comments. */
export interface SignalState {
  readonly path: string;
  readonly area: string;
  readonly hunk: string;
}

export interface SignalUnit {
  /** `path#hunkIndex[.part]` — unique within a pull. */
  readonly key: string;
  readonly pullNumber: number;
  readonly path: string;
  readonly hunkIndex: number;
  readonly part: number;
  readonly state: SignalState;
  /** sha256 of the state payload (see cacheKeyFor). */
  readonly stateHash: string;
  /** Not evaluable: no patch (binary/too large) — routes to human review. */
  readonly noPatch: boolean;
  /** Not evaluable: a single line exceeds the token budget. */
  readonly oversize: boolean;
}

export interface SignalModel {
  /** Model id used in cache keys (pinned, e.g. "jev-1.13.0" or "synthetic-v1"). */
  readonly id: string;
  /**
   * Answers every question for every unit. A `null` entry is a unit that could
   * not be evaluated (error / budget) — aggregation treats it as unknown risk.
   */
  evaluate(units: readonly SignalUnit[], qs: QuestionSet): Promise<Array<UnitAnswers | null>>;
}

/** $ per million input tokens (output is free) — for run cost accounting. */
export const JEV_INPUT_USD_PER_MTOK = 0.042;

/** A cached, persisted model answer set for one unit (content-addressed). */
export interface SignalRecord {
  readonly cacheKey: string;
  readonly repoId: string;
  readonly pullNumber: number;
  readonly unitKey: string;
  /** The requested (pinned) model id used in the cache key. */
  readonly modelId: string;
  readonly questionSetVersion: string;
  readonly result: UnitAnswers;
  readonly evaluatedAt: string;
}

/** Summary of one `runSignals` pass (cost + coverage accounting). */
export interface SignalRunRecord {
  readonly repoId: string;
  readonly runAt: string;
  readonly modelId: string;
  readonly questionSetVersion: string;
  readonly pulls: number;
  readonly units: number;
  readonly cached: number;
  readonly evaluated: number;
  readonly failed: number;
  readonly skippedBudget: number;
  readonly notEvaluable: number;
  readonly inputTokens: number;
  readonly costUsd: number;
  /** Versioned model ids the provider reported (should be exactly the pinned one). */
  readonly reportedModelIds: readonly string[];
}
