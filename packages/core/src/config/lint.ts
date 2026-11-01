// Lint rules: the repo's own Markdown rule files, in the format the Gallant
// linter uses (`.agents/gallant/*.md`), asked of the same decision model as
// the risk signals but in a separate lane. They only add findings: a failing
// rule is a P2 note by default, or a P1 when the rule (or this config) says
// so, and it can never request changes unless the repo lets signals do that.
// They never change the risk score, the fast path, or the calibration.
// Browser-safe.

import { z } from "zod";

/** off: not run · observe: findings shown but never acted on · on: findings count like other signal findings. */
export const LINT_MODES = ["off", "observe", "on"] as const;
export type LintMode = (typeof LINT_MODES)[number];

/** Lint findings are capped at P1: a lint rule can ask for a human, never block on its own. */
export const LINT_LEVELS = ["p1", "p2"] as const;
export type LintLevel = (typeof LINT_LEVELS)[number];

export interface LintConfig {
  readonly mode: LintMode;
  /** Folder of rule files, relative to the repository root, read from the default branch. */
  readonly dir: string;
  /** Level of a failing rule that does not set `pullupLevel` itself. */
  readonly level: LintLevel;
  /** Hard stop for one run's spend on lint checks (USD); left-over files are not checked. */
  readonly budgetUsdPerRun: number;
}

export const DEFAULT_LINT_DIR = ".agents/gallant";

export const DEFAULT_LINT: LintConfig = {
  mode: "off",
  dir: DEFAULT_LINT_DIR,
  level: "p2",
  budgetUsdPerRun: 0.5,
};

/** A relative folder inside the repo: no leading slash, no `..`, plain path characters. */
const DIR_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,200}$/;

export const lintSchema = z
  .object({
    mode: z.enum(LINT_MODES).optional(),
    dir: z.string().regex(DIR_RE, "A folder inside the repo, such as .agents/gallant (no leading slash or ..).").optional(),
    level: z.enum(LINT_LEVELS, { error: "Lint rules can only be P1 or P2." }).optional(),
    budgetUsdPerRun: z.number().min(0).max(100).optional(),
  })
  .strict();

export type LintFile = z.infer<typeof lintSchema>;

export function resolveLint(file: LintFile = {}): LintConfig {
  const dir = (file.dir ?? DEFAULT_LINT.dir).replace(/\/+$/, "");
  return { ...DEFAULT_LINT, ...file, dir };
}
