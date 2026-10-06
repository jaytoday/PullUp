// Guardrails — the deterministic, human-configured envelope inside which the
// bot may approve (taxonomy: "approve is an allowlist outcome"). Two kinds of
// outcome:
//
//   requiresHuman  → escalate now (a category hit: CI workflows, auth, new deps…)
//   approveBlocker → the bot may not approve (too large, tier too high, freeze…);
//                    once w* passes it defers to a human instead of approving
//
// Guardrails never lower risk and never touch the cost math. Browser-safe.

import { z } from "zod";
import type { RequireHumanCategory } from "../policy/categories.js";
import { REQUIRE_HUMAN_CATEGORIES, resolveCategories } from "../policy/categories.js";

/** Tiers, lowest risk first. A PR's tier is the max over its files. */
export const TIERS = ["trivial", "low", "standard", "high", "critical"] as const;
export type Tier = (typeof TIERS)[number];

/** Tiers the bot may ever approve (high/critical never). */
export const APPROVABLE_TIERS = ["trivial", "low", "standard"] as const;
export type ApprovableTier = (typeof APPROVABLE_TIERS)[number];

export const DEP_UPDATE_KINDS = ["patch:dev", "minor:dev", "patch:runtime", "minor:runtime"] as const;
export type DepUpdateKind = (typeof DEP_UPDATE_KINDS)[number];

export const SIZE_STEP = 50;
export const SIZE_MAX = 1000;
export const FILES_MAX = 50;

export interface FreezeWindow {
  readonly start: string;
  readonly end: string;
  readonly note?: string;
}

export interface GuardrailsConfig {
  /** Lines changed (excl. sizeExcludeGlobs) above which the bot can't approve; null = no limit. */
  readonly maxAutoApproveLines: number | null;
  readonly maxAutoApproveFiles: number | null;
  readonly sizeExcludeGlobs: readonly string[];
  readonly requireHumanCategories: Readonly<Record<RequireHumanCategory, boolean>>;
  /** Extra path tiers. trivial = policy allowlist; critical = requireHuman globs. */
  readonly tiers: { readonly low: readonly string[]; readonly high: readonly string[] };
  /** Highest tier the bot may approve. */
  readonly approveMaxTier: ApprovableTier;
  readonly dependencies: {
    /** Update kinds the bot may approve. Anything else (incl. unknown) blocks approval. */
    readonly autoApprove: readonly DepUpdateKind[];
    /** Needs registry metadata PullUp doesn't ingest yet — stored, not enforced. */
    readonly minReleaseAgeDays: number | null;
  };
  readonly tests: {
    /** Production code changed with no test file changed → blocks approval. */
    readonly requireForBehaviorChange: boolean;
    /** Test-only PRs count as the trivial tier (fast-path eligible). */
    readonly testOnlyFastPath: boolean;
  };
  readonly authors: {
    /** Logins (globs) whose PRs are AI-authored; also the `ai-generated` label. */
    readonly aiAuthors: readonly string[];
    /** Size limits are multiplied by this for AI-authored PRs (≤ 1). */
    readonly aiSizeMultiplier: number;
    /** Bots exempt from the first-time-contributor rule. */
    readonly trustedBots: readonly string[];
  };
  readonly freezeWindows: readonly FreezeWindow[];
}

export const DEFAULT_SIZE_EXCLUDES: readonly string[] = [
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/Cargo.lock",
  "**/poetry.lock",
  "**/Gemfile.lock",
  "**/go.sum",
  "vendor/**",
  "**/dist/**",
  "**/*.min.*",
  "**/__snapshots__/**",
  "**/*.snap",
];

export const DEFAULT_GUARDRAILS: GuardrailsConfig = {
  maxAutoApproveLines: null,
  maxAutoApproveFiles: null,
  sizeExcludeGlobs: DEFAULT_SIZE_EXCLUDES,
  requireHumanCategories: resolveCategories(),
  tiers: { low: [], high: [] },
  approveMaxTier: "standard",
  dependencies: { autoApprove: [...DEP_UPDATE_KINDS], minReleaseAgeDays: null },
  tests: { requireForBehaviorChange: false, testOnlyFastPath: true },
  authors: { aiAuthors: [], aiSizeMultiplier: 1, trustedBots: ["dependabot[bot]", "renovate[bot]"] },
  freezeWindows: [],
};

/** Globs: restricted charset, relative, no traversal. */
export const globSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.*?/\-[\]{},@+~]+$/, "glob has unsupported characters")
  .refine((g) => !g.startsWith("/") && !g.split("/").includes(".."), "glob must be relative with no '..'");

const globList = z.array(globSchema).max(50);
const login = z.string().regex(/^[A-Za-z0-9*][A-Za-z0-9*._-]{0,38}(?:\[bot\])?$/, "not a GitHub login");
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "not a date");

const categoriesSchema = z
  .object(
    Object.fromEntries(
      REQUIRE_HUMAN_CATEGORIES.map((c) => [
        c.id,
        (c.locked ? z.literal(true, { error: `${c.label} is always on` }) : z.boolean()).optional(),
      ]),
    ) as Record<RequireHumanCategory, z.ZodOptional<z.ZodBoolean | z.ZodLiteral<true>>>,
  )
  .strict();

export const guardrailsSchema = z
  .object({
    maxAutoApproveLines: z
      .number()
      .int()
      .min(0)
      .max(SIZE_MAX)
      .refine((n) => n % SIZE_STEP === 0, `must be a multiple of ${SIZE_STEP}`)
      .nullable()
      .optional(),
    maxAutoApproveFiles: z.number().int().min(1).max(FILES_MAX).nullable().optional(),
    sizeExcludeGlobs: globList.optional(),
    requireHumanCategories: categoriesSchema.optional(),
    tiers: z.object({ low: globList.optional(), high: globList.optional() }).strict().optional(),
    approveMaxTier: z.enum(APPROVABLE_TIERS).optional(),
    dependencies: z
      .object({
        autoApprove: z.array(z.enum(DEP_UPDATE_KINDS)).optional(),
        minReleaseAgeDays: z.number().int().min(0).max(30).nullable().optional(),
      })
      .strict()
      .optional(),
    tests: z
      .object({ requireForBehaviorChange: z.boolean().optional(), testOnlyFastPath: z.boolean().optional() })
      .strict()
      .optional(),
    authors: z
      .object({
        aiAuthors: z.array(login).max(20).optional(),
        aiSizeMultiplier: z.number().min(0.25).max(1).optional(),
        trustedBots: z.array(login).max(20).optional(),
      })
      .strict()
      .optional(),
    freezeWindows: z
      .array(
        z
          .object({ start: isoDate, end: isoDate, note: z.string().max(80).optional() })
          .strict()
          .refine((w) => Date.parse(w.start) < Date.parse(w.end), "freeze window must end after it starts"),
      )
      .max(20)
      .optional(),
  })
  .strict();

export type GuardrailsFile = z.infer<typeof guardrailsSchema>;

export function resolveGuardrails(file: GuardrailsFile = {}): GuardrailsConfig {
  const d = DEFAULT_GUARDRAILS;
  return {
    maxAutoApproveLines: file.maxAutoApproveLines === undefined ? d.maxAutoApproveLines : file.maxAutoApproveLines,
    maxAutoApproveFiles: file.maxAutoApproveFiles === undefined ? d.maxAutoApproveFiles : file.maxAutoApproveFiles,
    sizeExcludeGlobs: file.sizeExcludeGlobs ?? d.sizeExcludeGlobs,
    requireHumanCategories: resolveCategories(file.requireHumanCategories),
    tiers: { low: file.tiers?.low ?? d.tiers.low, high: file.tiers?.high ?? d.tiers.high },
    approveMaxTier: file.approveMaxTier ?? d.approveMaxTier,
    dependencies: {
      autoApprove: file.dependencies?.autoApprove ?? d.dependencies.autoApprove,
      minReleaseAgeDays:
        file.dependencies?.minReleaseAgeDays === undefined
          ? d.dependencies.minReleaseAgeDays
          : file.dependencies.minReleaseAgeDays,
    },
    tests: {
      requireForBehaviorChange: file.tests?.requireForBehaviorChange ?? d.tests.requireForBehaviorChange,
      testOnlyFastPath: file.tests?.testOnlyFastPath ?? d.tests.testOnlyFastPath,
    },
    authors: {
      aiAuthors: file.authors?.aiAuthors ?? d.authors.aiAuthors,
      aiSizeMultiplier: file.authors?.aiSizeMultiplier ?? d.authors.aiSizeMultiplier,
      trustedBots: file.authors?.trustedBots ?? d.authors.trustedBots,
    },
    freezeWindows: file.freezeWindows ?? d.freezeWindows,
  };
}
