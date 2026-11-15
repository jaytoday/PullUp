import { z } from "zod";
import { SENSITIVE_CATEGORIES, type SensitiveCategory } from "./paths";

/**
 * A repository's `.pullup/config.json`, always read from the default branch,
 * never from the pull request, so a pull request cannot loosen the checks it
 * is judged by. Used in the browser too (the settings page), so no Node modules.
 */

export const CONCERNS = ["flaky_retry", "deleted_tests", "sensitive_change"] as const;
export type Concern = (typeof CONCERNS)[number];

export const CONCERN_LABEL: Record<Concern, string> = {
  flaky_retry: "Flaky retry",
  deleted_tests: "Deleted or weakened tests",
  sensitive_change: "Sensitive change",
};

const sensitiveIds = Object.keys(SENSITIVE_CATEGORIES) as [SensitiveCategory, ...SensitiveCategory[]];

export const configSchema = z.object({
  /** Workflows that must finish before PullUp decides. A required workflow that never ran is a hard failure. */
  requiredWorkflows: z.array(z.string().min(1)).min(1),
  flaky: z
    .object({
      /** Tests known to fail now and then. A failure of only these tests is a concern to judge, not a hard failure. */
      knownTests: z.array(z.string()).default([]),
      /** Rerun a required workflow's failed jobs once (costs CI minutes; off by default). The agent's `rerun_job` tool needs this. */
      rerun: z.boolean().default(false),
    })
    .default({ knownTests: [], rerun: false }),
  /** Switch a concern off. All three are on by default. */
  concerns: z.object({ flaky_retry: z.boolean().default(true), deleted_tests: z.boolean().default(true), sensitive_change: z.boolean().default(true) }).default({ flaky_retry: true, deleted_tests: true, sensitive_change: true }),
  sensitivePaths: z
    .object({
      /** Categories to leave out (all are on by default). */
      off: z.array(z.enum(sensitiveIds)).default([]),
      /** More globs that count as sensitive, for example `src/billing/**`. */
      extraGlobs: z.array(z.string().min(1)).default([]),
    })
    .default({ off: [], extraGlobs: [] }),
  /** GitHub logins whose Pass and Fail buttons and `/pullup` comments settle a review. Repository admins always may. */
  reviewers: z.array(z.string().min(1)).default([]),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;

export function parseConfig(raw: unknown): Config {
  return configSchema.parse(raw);
}
