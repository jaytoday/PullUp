// Evidence verifier settings: a second, read-only pass that checks PullUp's
// strongest risk-signal findings against the code and returns quoted,
// machine-checked evidence. Raise-only: a confirmed finding may request
// changes (with severity.signalsCanRequestChanges = "verified"); nothing it
// says can remove a finding, lower a level or enable an approval. Browser-safe.

import { z } from "zod";

export interface VerifyConfig {
  readonly enabled: boolean;
  /** Model for the live verifier. */
  readonly model: string;
  /** Findings verified per pull request, most severe first. */
  readonly maxPerPull: number;
  /** Also verify while signals are only observed (verdicts shown, never used). */
  readonly inObserve: boolean;
  /** Hard stop on live verifier spend per UTC day, per repo. */
  readonly budgetUsdPerDay: number;
}

export const DEFAULT_VERIFY: VerifyConfig = {
  enabled: false,
  model: "claude-opus-5",
  maxPerPull: 3,
  inObserve: false,
  budgetUsdPerDay: 5,
};

export const verifySchema = z
  .object({
    enabled: z.boolean().optional(),
    model: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,63}$/, "Model: a model id such as claude-opus-5.").optional(),
    maxPerPull: z.number().int().min(1).max(10).optional(),
    inObserve: z.boolean().optional(),
    budgetUsdPerDay: z.number().min(0).max(500).optional(),
  })
  .strict();

export type VerifyFile = z.infer<typeof verifySchema>;

export function resolveVerify(file: VerifyFile = {}): VerifyConfig {
  return { ...DEFAULT_VERIFY, ...file };
}
