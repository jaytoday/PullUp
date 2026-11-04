import { z } from "zod";
import { SENSITIVE_CATEGORIES, type SensitiveCategory } from "./paths";

/**
 * A repository's `.pullup/config.json`, always read from the default branch,
 * never from the pull request, so a pull request cannot loosen its own checks.
 * Only fields the engine reads are here; each phase adds its own.
 */

export const TRIGGER_IDS = ["flaky-test", "weakened-tests", "sensitive-path"] as const;
export type TriggerId = (typeof TRIGGER_IDS)[number];

/** Whether the council may pass each trigger's question on its own, by default (the plan's trigger table). */
export const COUNCIL_MAY_PASS_DEFAULT: Record<TriggerId, boolean> = {
  "flaky-test": true,
  "weakened-tests": true,
  "sensitive-path": false,
};

const triggerSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  councilMayPass: z.boolean().optional(),
});

const sensitiveCategoryIds = Object.keys(SENSITIVE_CATEGORIES) as [SensitiveCategory, ...SensitiveCategory[]];

export const configSchema = z.object({
  /** Workflows that must finish before PullUp decides. A required workflow that never ran is a hard failure. */
  requiredWorkflows: z.array(z.string().min(1)).min(1),
  flaky: z
    .object({
      /** Tests known to fail now and then. A failure of only these tests is a question, not a hard failure. */
      knownTests: z.array(z.string()).default([]),
    })
    .default({ knownTests: [] }),
  /** Per trigger: switch it off, or change whether the council may pass it alone. */
  triggers: z.partialRecord(z.enum(TRIGGER_IDS), triggerSettingsSchema).default({}),
  sensitivePaths: z
    .object({
      /** Categories to leave out (all are on by default). */
      off: z.array(z.enum(sensitiveCategoryIds)).default([]),
      /** More globs that count as sensitive. */
      extraGlobs: z.array(z.string().min(1)).default([]),
    })
    .default({ off: [], extraGlobs: [] }),
});
export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;

export function parseConfig(raw: unknown): Config {
  return configSchema.parse(raw);
}

export function triggerEnabled(config: Config, id: TriggerId): boolean {
  return config.triggers[id]?.enabled ?? true;
}

export function councilMayPass(config: Config, id: TriggerId): boolean {
  return config.triggers[id]?.councilMayPass ?? COUNCIL_MAY_PASS_DEFAULT[id];
}
