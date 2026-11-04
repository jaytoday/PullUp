import { z } from "zod";

/**
 * The request schemas of WithAI's public API (`/api/v1`). The route handlers
 * validate with these, and the client's request types are inferred from them,
 * so the two cannot drift apart.
 *
 * Kept free of everything but zod so a browser app can import it too.
 */

// ── Shared pieces ────────────────────────────────────────────────────────────

const optionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(200),
});

/**
 * The answer every panel seat gives every round (and `apply` returns):
 * - `choice`: one of `options`, with a strength from 1 to 5 and a reason;
 * - `verdict`: confirms / against / unclear, with a confidence from 0 to 1 and a reason;
 * - `schema`: an object matching your JSON Schema (`type: "object"`).
 */
export const answerShapeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    question: z.string().trim().min(1).max(500),
    options: z.array(optionSchema).min(2).max(10),
  }),
  z.object({ type: z.literal("verdict"), question: z.string().trim().min(1).max(500) }),
  z.object({
    type: z.literal("schema"),
    question: z.string().trim().min(1).max(500),
    schema: z.record(z.string(), z.unknown()).refine((s) => s.type === "object", 'The schema must have "type": "object".'),
  }),
]);
export type AnswerShapeInput = z.infer<typeof answerShapeSchema>;

/** One panel seat an app supplies instead of letting WithAI design the panel. */
export const seatSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(200),
  viewpoint: z.string().trim().min(1).max(2000),
  /** Why a serious, informed person holds this view. */
  validity: z.string().trim().max(1000).optional(),
  /** What would change this seat's mind. */
  wouldChangeMind: z.string().trim().max(1000).optional(),
});
export type SeatInput = z.infer<typeof seatSchema>;

/** A question people (and the judge) answer about the scenario. */
export const questionSchema = z.object({
  prompt: z.string().trim().min(1).max(200),
  kind: z.enum(["choice", "scale", "text"]).default("choice"),
  options: z.array(optionSchema).max(5).default([]),
});

/** Overrides on the workspace's panel protocol; values are clamped to its limits. */
export const protocolOverridesSchema = z.object({
  /** How many rounds: 1 (opening only), 2 (opening, final), 3+ (opening, rebuttals, final). Up to 5. */
  rounds: z.number().int().min(1).max(5).optional(),
  /** Words per seat per round. */
  wordBudget: z.number().int().min(60).max(600).optional(),
  /** Run the judge at the end (default true). */
  judge: z.boolean().optional(),
  /** Ask a person to approve the panel before it argues (default false for the API). */
  approvals: z.boolean().optional(),
  /** Most model calls the run may make. */
  maxModelCalls: z.number().int().min(4).max(60).optional(),
  /** Whether seats cite the workspace's earlier learnings. */
  citations: z.enum(["off", "encouraged", "required"]).optional(),
});
export type ProtocolOverridesInput = z.infer<typeof protocolOverridesSchema>;

const webhookUrl = z.string().url().max(2000).refine((u) => /^https?:\/\//.test(u), "Use an http or https URL.");

// ── Scenarios ────────────────────────────────────────────────────────────────

export const createScenarioSchema = z.object({
  title: z.string().trim().min(1).max(300),
  area: z.string().trim().min(1).max(120).default("general"),
  /** Background the panel argues against (a case, a game state, a strategy). */
  context: z.string().trim().max(20000).optional(),
  /** Your own seats (3 to 5). When given, WithAI makes no panel-design call. */
  seats: z.array(seatSchema).min(3).max(5).optional(),
  /** Questions for people and the judge. When given, no framing call is made. */
  questions: z.array(questionSchema).max(6).optional(),
  /** The structured answer every seat gives every round. */
  answer: answerShapeSchema.optional(),
  protocol: protocolOverridesSchema.optional(),
  /** Start the panel straight away (same as `POST /runs` with this scenario). */
  start: z.boolean().default(false),
  /** Where to post this scenario's run events, besides the token's webhook. */
  webhookUrl: webhookUrl.optional(),
  /** Link the scenario to a workspace skill (id or slug), so its human answers come back through that skill's labels. */
  skillId: z.string().trim().min(1).max(200).optional(),
  /** A caller's own record of the case (for example a pack, task type and input), returned with the labels. */
  case: z.unknown().optional(),
});
export type CreateScenarioInput = z.input<typeof createScenarioSchema>;

// ── Runs ─────────────────────────────────────────────────────────────────────

export const createRunSchema = z.object({
  kind: z.enum(["panel", "theory-review"]).default("panel"),
  scenarioId: z.string().uuid(),
  webhookUrl: webhookUrl.optional(),
});
export type CreateRunInput = z.input<typeof createRunSchema>;

export const listRunsQuerySchema = z.object({
  kind: z.string().max(60).optional(),
  scenarioId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// ── Apply ────────────────────────────────────────────────────────────────────

export const applySchema = z.object({
  /** The guidance to apply: a workspace skill (by id, optionally a version number) or inline text. */
  skill: z
    .union([
      z.object({ id: z.string().uuid(), version: z.number().int().min(1).optional() }),
      z.object({ text: z.string().trim().min(1).max(60000) }),
    ])
    .optional(),
  /** The situation, as any JSON value (a game state, a set of tiles, market data). */
  state: z.unknown().optional(),
  /** What to decide. */
  request: z.string().trim().min(1).max(8000),
  answer: answerShapeSchema,
  /** `cheap` for speed and cost, `standard` for quality. */
  tier: z.enum(["cheap", "standard"]).default("cheap"),
  /** A viewpoint to answer from, for "several seats in parallel" use. */
  viewpoint: z.string().trim().max(2000).optional(),
  /** Output token limit for the call (the model's reasoning counts against it). Default 2,048. */
  maxTokens: z.number().int().min(256).max(16000).optional(),
});
export type ApplyInput = z.input<typeof applySchema>;

// ── Skills ───────────────────────────────────────────────────────────────────

/** Create a starter skill from one of WithAI's templates (once per workspace; a repeat returns the existing one). */
export const createSkillSchema = z.object({ template: z.enum(["ci-policy"]) });
export type CreateSkillInput = z.input<typeof createSkillSchema>;

// ── Ask a person ─────────────────────────────────────────────────────────────

export const recipientSchema = z.union([
  z.object({ userId: z.string().trim().min(1) }),
  z.object({ email: z.string().trim().email() }),
  z.object({ phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Use international format, e.g. +15551234567.") }),
]);

export const createQuestionSchema = z
  .object({
    prompt: z.string().trim().min(1).max(500),
    details: z.string().trim().max(4000).optional(),
    options: z.array(optionSchema).max(10).default([]),
    /** Let the person type an answer (always on when there are no options). */
    allowText: z.boolean().default(false),
    to: recipientSchema,
    /** When the question expires (ISO 8601). Give this or `expiresInMinutes`. */
    deadline: z.string().datetime({ offset: true }).optional(),
    expiresInMinutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
    webhookUrl: webhookUrl.optional(),
    /** The run this question belongs to, if any (for example a held trade). */
    runId: z.string().uuid().optional(),
    /** Link the question to a workspace skill (id or slug), so its answer comes back through that skill's labels. */
    skillId: z.string().trim().min(1).max(200).optional(),
    /** A caller's own record of the case (for example a CI run), returned with the labels. */
    case: z.unknown().optional(),
  })
  .refine((q) => q.deadline || q.expiresInMinutes, { message: "Give a deadline or expiresInMinutes." });
export type CreateQuestionInput = z.input<typeof createQuestionSchema>;

/** A person's answer, from the web page, the answer link, or Slack. */
export const answerQuestionSchema = z
  .object({
    optionId: z.string().trim().min(1).max(64).optional(),
    text: z.string().trim().max(4000).optional(),
  })
  .refine((a) => a.optionId || a.text, { message: "Pick an option or write an answer." });
