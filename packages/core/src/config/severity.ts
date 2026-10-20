// Severity policy — what PullUp does about a P0 / P1 / P2 finding.
//
//   P0 blocking   → Request changes · Ask a human
//   P1 important  → Request changes · Ask a human · Note only (approval allowed)
//   P2 minor      → Ask a human · Note only
//
// A finding's *source* matters as much as its level: rule-backed findings are
// reproducible; signal findings (Jev, custom questions) are probabilistic, so
// they may only request changes when the repo explicitly opts in. The
// injection tripwire always asks a human. Browser-safe.

import { z } from "zod";

export const SEVERITY_LEVELS = ["p0", "p1", "p2"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

export const SEVERITY_ACTIONS = ["request-changes", "ask-human", "note"] as const;
export type SeverityAction = (typeof SEVERITY_ACTIONS)[number];

/** Allowed actions per level (P0 can never let a PR through; P2 never blocks). */
export const LEVEL_OPTIONS: Readonly<Record<SeverityLevel, readonly SeverityAction[]>> = {
  p0: ["request-changes", "ask-human"],
  p1: ["request-changes", "ask-human", "note"],
  p2: ["ask-human", "note"],
};

/** Strictest first — used to combine findings and rules. */
export const ACTION_STRICTNESS: Readonly<Record<SeverityAction, number>> = {
  "request-changes": 2,
  "ask-human": 1,
  note: 0,
};

export const LEVEL_LABEL: Readonly<Record<SeverityLevel, string>> = { p0: "P0", p1: "P1", p2: "P2" };

export const LEVEL_MEANING: Readonly<Record<SeverityLevel, string>> = {
  p0: "Blocking — must be fixed or seen by a human before merge (auth, secrets, injection, unsafe schema changes).",
  p1: "Important — fix before merge, or a human agrees to defer (tests missing, risky but unconfirmed changes).",
  p2: "Minor — advisory; never blocks a merge.",
};

export const ACTION_LABEL_SEVERITY: Readonly<Record<SeverityAction, string>> = {
  "request-changes": "Request changes",
  "ask-human": "Ask a human",
  note: "Note only",
};

/** Per-level actions: P0 can't be a note, P2 can't request changes. */
export interface SeverityActions {
  readonly p0: "request-changes" | "ask-human";
  readonly p1: SeverityAction;
  readonly p2: "ask-human" | "note";
}

export interface SeverityConfig {
  readonly actions: SeverityActions;
  /**
   * Let signal (model) findings request changes, not just rule-confirmed ones:
   * false (ask a human), "verified" (only with an accepted confirmed verdict), or true.
   */
  readonly signalsCanRequestChanges: SignalsCanRequestChanges;
  /** Per-question level overrides (question id → level). Custom questions are capped at P1. */
  readonly questionLevels: Readonly<Record<string, SeverityLevel>>;
}

export type SignalsCanRequestChanges = boolean | "verified";

export const DEFAULT_SEVERITY: SeverityConfig = {
  actions: { p0: "request-changes", p1: "ask-human", p2: "note" },
  signalsCanRequestChanges: false,
  questionLevels: {},
};

const levelEnum = z.enum(SEVERITY_LEVELS);

export const severityActionsSchema = z
  .object({
    p0: z.enum(["request-changes", "ask-human"], { error: "P0 can only request changes or ask a human." }).optional(),
    p1: z.enum(SEVERITY_ACTIONS).optional(),
    p2: z.enum(["ask-human", "note"], { error: "P2 can only ask a human or be a note." }).optional(),
  })
  .strict();

export const severitySchema = z
  .object({
    actions: severityActionsSchema.optional(),
    signalsCanRequestChanges: z.union([z.boolean(), z.literal("verified")]).optional(),
    questionLevels: z.record(z.string().max(64), levelEnum).optional(),
  })
  .strict();

export type SeverityFile = z.infer<typeof severitySchema>;

export function resolveSeverity(file: SeverityFile = {}): SeverityConfig {
  return {
    actions: { ...DEFAULT_SEVERITY.actions, ...file.actions },
    signalsCanRequestChanges: file.signalsCanRequestChanges ?? DEFAULT_SEVERITY.signalsCanRequestChanges,
    questionLevels: { ...file.questionLevels },
  };
}

export function stricterAction(a: SeverityAction, b: SeverityAction): SeverityAction {
  return ACTION_STRICTNESS[a] >= ACTION_STRICTNESS[b] ? a : b;
}
