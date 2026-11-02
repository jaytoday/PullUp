// Walkthrough links: when a pull request changes a walkthrough file (a
// Markdown "living spec" such as the ones the diffmap agent skill writes in
// `specs/`), PullUp's decision comment links to it for the human reviewer.
// Reviewer help only — a walkthrough never changes a decision, a finding or an
// action, and nothing reads its contents. Browser-safe.

import { z } from "zod";

export interface WalkthroughConfig {
  readonly enabled: boolean;
  /** Globs for walkthrough files (PullUp's glob syntax: `**` spans folders). */
  readonly paths: readonly string[];
  /** At most this many links per comment, in path order. */
  readonly maxLinks: number;
}

export const DEFAULT_WALKTHROUGHS: WalkthroughConfig = {
  enabled: true,
  paths: ["specs/**/*.md", "specs/**/*.mdx"],
  maxLinks: 3,
};

export const walkthroughsSchema = z
  .object({
    enabled: z.boolean().optional(),
    paths: z.array(z.string().min(1)).max(20).optional(),
    maxLinks: z.number().int().min(1).max(10).optional(),
  })
  .strict();

export type WalkthroughsFile = z.infer<typeof walkthroughsSchema>;

export function resolveWalkthroughs(file: WalkthroughsFile = {}): WalkthroughConfig {
  return { ...DEFAULT_WALKTHROUGHS, ...file };
}
