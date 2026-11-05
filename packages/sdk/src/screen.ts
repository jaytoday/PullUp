import { z } from "zod";

/**
 * Screens: small, cheap model questions an extension asks the host to put to
 * WithAI (for example "does this file break rule X?"). The extension never
 * calls the network: it returns requests from `screens`, and receives the
 * answers in `ctx.screens`, already checked. A screen that could not run, or
 * whose "yes" has no quote that really is in the change, comes back as
 * `not-checked`, which the extension must turn into a note or a question,
 * never a silent pass.
 */

export const screenRequestSchema = z.object({
  /** Unique within the extension's screens for the run. */
  key: z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/),
  /** The question, in one sentence. */
  question: z.string().min(1).max(500),
  /** Text the model judges by (for example a rule), sent fenced as quoted data from the repository. */
  guidance: z.string().max(8000).default(""),
  /** The changed file the screen is about; its changed lines are sent and quotes must come from them. Null: the whole diff. */
  file: z.string().nullable().default(null),
  /** Possible answers. For a yes/no screen, "yes" means "found a problem". */
  options: z.array(z.string().min(1).max(60)).min(2).max(10).default(["yes", "no"]),
  /** Answers that report a problem and so must quote the changed line that shows it. Default: the first option. */
  needsQuote: z.array(z.string()).optional(),
});
export type ScreenRequest = z.input<typeof screenRequestSchema>;
export type ParsedScreenRequest = z.infer<typeof screenRequestSchema>;

/** What the model returns for one screen (checked by the host before an extension sees it). */
export const screenModelAnswerSchema = z.object({
  result: z.string().max(60),
  /** How sure, from 0 to 1. */
  confidence: z.number().min(0).max(1),
  reason: z.string().max(2000),
  quotes: z.array(z.object({ text: z.string().max(1000) })).max(8),
});

export interface ScreenAnswer {
  key: string;
  status: "answered" | "not-checked";
  /** One of the request's options, when answered. */
  result: string | null;
  confidence: number;
  reason: string;
  /** Quotes that really are on changed lines of the file (or the diff). */
  quotes: { text: string; line: number | null; file: string }[];
  /** Why it was not checked: the call failed, the run's screen limit was reached, the answer had no valid quote… */
  why: string | null;
}
