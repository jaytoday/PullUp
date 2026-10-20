// GitHub Check run settings: whether PullUp posts one "PullUp" check per pull
// request head, and whether a change request may fail it. Browser-safe.
//
// A check never makes approval easier: `success` needs an APPROVE that is
// itself sent (approve at act, approval gate passed), and the Evaluation mode
// (comment level) always reports `neutral`. `blockOn` only matters when
// request changes is at act.

import { z } from "zod";

/**
 * When the check fails (and so blocks a merge if branch protection requires it).
 * Asking a human never fails the check: once a human reviews, PullUp stops
 * acting on the pull request, so a failing check would be left behind.
 */
export const CHECK_BLOCK_ON = ["never", "request-changes"] as const;
export type CheckBlockOn = (typeof CHECK_BLOCK_ON)[number];

export interface ChecksConfig {
  readonly enabled: boolean;
  /** The check's name — what branch protection requires. */
  readonly name: string;
  readonly blockOn: CheckBlockOn;
  /** Pin located findings to diff lines. */
  readonly annotations: boolean;
}

export const DEFAULT_CHECKS: ChecksConfig = {
  enabled: false,
  name: "PullUp",
  blockOn: "never",
  annotations: true,
};

export const CHECK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;

export const checksSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z
      .string()
      .regex(CHECK_NAME_PATTERN, "Check name: 1–40 letters, numbers, spaces, dots, dashes or underscores.")
      .optional(),
    blockOn: z.enum(CHECK_BLOCK_ON).optional(),
    annotations: z.boolean().optional(),
  })
  .strict();

export type ChecksFile = z.infer<typeof checksSchema>;

export function resolveChecks(file: ChecksFile = {}): ChecksConfig {
  return { ...DEFAULT_CHECKS, ...file };
}
