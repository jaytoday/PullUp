// Inline finding comments: PullUp's located findings posted on the diff lines
// they concern, and resolved when a later push makes them go away. Information
// only — they never change a decision or an action. Browser-safe.

import { z } from "zod";
import type { SeverityLevel } from "./severity.js";

export interface InlineConfig {
  readonly enabled: boolean;
  /** Post findings at this level or more severe (p0 most severe). */
  readonly reportOn: SeverityLevel;
  /** Also post findings while signals are only observed ("Observe only"). */
  readonly includeObserve: boolean;
  /** New inline comments per head, most severe first. */
  readonly maxComments: number;
  /** Resolve PullUp's own threads whose finding is gone. */
  readonly resolveFixed: boolean;
  /** Thread resolutions per run. */
  readonly maxResolutions: number;
}

export const DEFAULT_INLINE: InlineConfig = {
  enabled: false,
  reportOn: "p1",
  includeObserve: false,
  maxComments: 10,
  resolveFixed: true,
  maxResolutions: 20,
};

export const inlineSchema = z
  .object({
    enabled: z.boolean().optional(),
    reportOn: z.enum(["p0", "p1", "p2"]).optional(),
    includeObserve: z.boolean().optional(),
    maxComments: z.number().int().min(1).max(30).optional(),
    resolveFixed: z.boolean().optional(),
    maxResolutions: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export type InlineFile = z.infer<typeof inlineSchema>;

export function resolveInline(file: InlineFile = {}): InlineConfig {
  return { ...DEFAULT_INLINE, ...file };
}
