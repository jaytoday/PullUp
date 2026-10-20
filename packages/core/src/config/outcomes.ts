// Decision-outcome settings: the windows used to judge what humans did after
// a PullUp decision. Affects only the Outcomes page and learnings — never a
// decision or an action. Browser-safe.

import { z } from "zod";

export interface OutcomesConfig {
  /** A human approval of the same commit within this many minutes counts as "the ask wasn't needed". */
  readonly quickApproveMinutes: number;
  /** A revert or hotfix within this many days of merging counts against an approval. */
  readonly defectWindowDays: number;
}

export const DEFAULT_OUTCOMES: OutcomesConfig = { quickApproveMinutes: 30, defectWindowDays: 14 };

export const outcomesSchema = z
  .object({
    quickApproveMinutes: z.number().int().min(1).max(24 * 60).optional(),
    defectWindowDays: z.number().int().min(1).max(90).optional(),
  })
  .strict();

export type OutcomesFile = z.infer<typeof outcomesSchema>;

export function resolveOutcomes(file: OutcomesFile = {}): OutcomesConfig {
  return { ...DEFAULT_OUTCOMES, ...file };
}
