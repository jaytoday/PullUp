import { z } from "zod";

/**
 * A repository's `.pullup/config.json`, always read from the default branch,
 * never from the pull request, so a pull request cannot loosen its own checks.
 * Only fields the engine reads are here; each phase adds its own.
 */
export const configSchema = z.object({
  /** Workflows that must finish before PullUp decides. A required workflow that never ran is a hard failure. */
  requiredWorkflows: z.array(z.string().min(1)).min(1),
  flaky: z
    .object({
      /** Tests known to fail now and then. A failure of only these tests is a question, not a hard failure. */
      knownTests: z.array(z.string()).default([]),
    })
    .default({ knownTests: [] }),
});
export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;

export function parseConfig(raw: unknown): Config {
  return configSchema.parse(raw);
}
