/**
 * Response shapes of WithAI's public API. Request shapes are inferred from the
 * validation schemas in `./schemas`.
 */

export type RunStatus = "queued" | "running" | "waiting-for-person" | "done" | "failed" | "cancelled";

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Calls to a model with no known price; `costUsd` leaves them out. */
  unpricedCalls: number;
}

export type StructuredAnswer =
  | { type: "choice"; optionId: string; strength: number; reason: string }
  | { type: "verdict"; verdict: "confirms" | "against" | "unclear"; confidence: number; reason: string }
  | { type: "schema"; value: Record<string, unknown> };

/** One seat's structured answer in one round; a seat with no valid answer is marked failed, never left out. */
export interface SeatRoundAnswer {
  round: number;
  seat: number;
  name: string | null;
  status: "ok" | "failed";
  answer?: StructuredAnswer;
  error?: string;
}

export interface Scenario {
  id: string;
  title: string;
  area: string;
  status: string;
  kind: string;
  createdAt: string | null;
  roster: { seat: number; name: string; role: string; viewpoint: string }[];
  questions: { id: string; prompt: string; kind: string; options: { id: string; label: string }[] }[];
  answerShape: unknown | null;
  summary: unknown | null;
  /** The newest run on this scenario, if any. */
  runId: string | null;
}

export interface Run {
  id: string;
  kind: string;
  status: RunStatus;
  scenarioId: string | null;
  input: unknown;
  result: unknown;
  error: string | null;
  usage: Usage;
  costUsd: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** The URL of this run's event stream. */
  eventsUrl: string;
}

export interface RunEvent {
  /** `<runId>:<seq>`; also the server-sent event id. */
  id: string;
  type: "run.started" | "run.progress" | "run.waiting" | "run.resumed" | "run.done" | "run.failed" | "run.cancelled" | string;
  runId: string;
  seq: number;
  createdAt: string;
  data: unknown;
}

export interface ApplyResult {
  runId: string;
  answer: StructuredAnswer | null;
  status: "ok" | "invalid";
  error?: string;
  model: string;
  usage: Usage;
  costUsd: number;
  durationMs: number;
}

export interface PersonQuestion {
  id: string;
  status: "open" | "answered" | "expired" | "cancelled";
  prompt: string;
  details: string | null;
  options: { id: string; label: string }[];
  allowText: boolean;
  to: { userId: string } | { email: string } | { phone: string };
  deadline: string;
  answer: { optionId?: string; text?: string } | null;
  answeredBy: string | null;
  answeredVia: string | null;
  answeredAt: string | null;
  deliveries: { channel: string; ok: boolean; error?: string }[];
  runId: string | null;
  skillId: string | null;
  case: unknown | null;
  createdAt: string;
}

/** The body of an error response. */
export interface ApiErrorBody {
  statusCode: number;
  statusMessage: string;
  message: string;
  data?: unknown;
}
/** A workspace skill's text at one version (`GET /api/v1/skills/:idOrSlug`). */
export interface SkillDocument {
  id: string;
  slug: string;
  name: string;
  version: number;
  versionId: string;
  body: string;
  /** Hash of the body, so a caller can pin exactly the judgment it used. */
  hash: string;
  sections: { kind: string; heading: string }[];
}

/**
 * Human answers linked to a skill (`GET /api/v1/skills/:id/labels`): from the
 * skill's scenarios (one group per scenario, `questionId` null) and from "ask
 * a person" questions linked to it (one group per question, `scenarioId` null).
 * Only the owner's answers and answers the owner endorsed are returned; the
 * simulated panel's answers never are.
 */
export interface SkillLabelGroup {
  scenarioId: string | null;
  /** The "ask a person" question this group comes from, or null for a scenario. */
  questionId: string | null;
  title: string;
  /** The case a caller attached when it created the scenario (for example Supermodel's pack, task type and input), or null. */
  case: unknown | null;
  /** The situation as pasted (private to the workspace), or the scenario's source text. */
  situation: string | null;
  /** The summary invitees see, with names and amounts removed unless essential. Prefer it when showing the case to others. */
  sharedContext: string | null;
  answers: {
    questionId: string;
    prompt: string;
    optionId: string | null;
    /** The chosen option's label, for choice questions. */
    optionLabel: string | null;
    text: string | null;
    voice: "owner" | "endorsed";
    answeredAt: string | null;
  }[];
}
