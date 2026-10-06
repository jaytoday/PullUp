// Action authority — what PullUp is allowed to *send* for each decision.
//
//   off     → nothing on GitHub (the dashboard still shows it, as "suppressed")
//   comment → one PullUp comment per PR, edited in place: "PullUp would approve…"
//   act     → the real review action
//
// Authority changes only what is sent, never the decision: decisions, bands,
// w* and guardrails are computed identically at every level, so Evaluation is a
// faithful rehearsal of Full. Browser-safe (types, modes and schema only).

import { z } from "zod";

export const AUTHORITY_LEVELS = ["off", "comment", "act"] as const;
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

export const AUTHORITY_ACTIONS = ["approve", "requestChanges", "requestHuman"] as const;
export type AuthorityAction = (typeof AUTHORITY_ACTIONS)[number];

export type ActionAuthority = Readonly<Record<AuthorityAction, AuthorityLevel>>;

export const NAMED_MODES = ["off", "evaluation", "block-only", "full"] as const;
export type NamedMode = (typeof NAMED_MODES)[number];

export const MODE_AUTHORITY: Readonly<Record<NamedMode, ActionAuthority>> = {
  off: { approve: "off", requestChanges: "off", requestHuman: "off" },
  evaluation: { approve: "comment", requestChanges: "comment", requestHuman: "comment" },
  "block-only": { approve: "comment", requestChanges: "act", requestHuman: "act" },
  full: { approve: "act", requestChanges: "act", requestHuman: "act" },
};

export const MODE_LABEL: Readonly<Record<NamedMode | "custom", string>> = {
  off: "Off",
  evaluation: "Evaluation",
  "block-only": "Block only",
  full: "Full",
  custom: "Custom",
};

export const MODE_HINT: Readonly<Record<NamedMode | "custom", string>> = {
  off: "PullUp stays silent on GitHub. Decisions still show here.",
  evaluation: "PullUp comments with what it would do. It never approves or requests changes.",
  "block-only": "PullUp requests changes and asks humans, but only comments when it would approve.",
  full: "PullUp approves, requests changes, and asks humans on its own.",
  custom: "A per-action combination that matches no named mode.",
};

export const ACTION_LABEL: Readonly<Record<AuthorityAction, string>> = {
  approve: "Approve",
  requestChanges: "Request changes",
  requestHuman: "Ask a human",
};

export const DEFAULT_AUTHORITY: ActionAuthority = MODE_AUTHORITY.evaluation;

export const actionsSchema = z
  .object({
    approve: z.enum(AUTHORITY_LEVELS).optional(),
    requestChanges: z.enum(AUTHORITY_LEVELS).optional(),
    requestHuman: z.enum(AUTHORITY_LEVELS).optional(),
  })
  .strict();

export type ActionsFile = z.infer<typeof actionsSchema>;

export function resolveAuthority(file: ActionsFile = {}): ActionAuthority {
  return { ...DEFAULT_AUTHORITY, ...file };
}

/** The named mode a combination matches, or "custom". */
export function namedModeOf(a: ActionAuthority): NamedMode | "custom" {
  for (const m of NAMED_MODES) {
    const x = MODE_AUTHORITY[m];
    if (AUTHORITY_ACTIONS.every((k) => x[k] === a[k])) return m;
  }
  return "custom";
}

/** Approves on its own but never blocks — valid, flagged as unusual. */
export function approvesWithoutBlocking(a: ActionAuthority): boolean {
  return a.approve === "act" && a.requestChanges !== "act";
}

export function summarizeAuthority(a: ActionAuthority): string {
  const word = (l: AuthorityLevel) => (l === "act" ? "yes" : l === "comment" ? "comment only" : "off");
  return `Approves: ${word(a.approve)} · Blocks: ${word(a.requestChanges)} · Asks humans: ${word(a.requestHuman)}`;
}

export const AUTHORITY_RANK: Readonly<Record<AuthorityLevel, number>> = { off: 0, comment: 1, act: 2 };
