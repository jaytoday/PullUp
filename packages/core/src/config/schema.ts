// PullUp priors — the named, configurable inputs to the two-cost model.
//
// Every prior is either literature/heuristic-derived (documented inline) or
// user-set via `pullup.config.json`. Repo-measured parameters are shrunk toward
// these (see cost/params.ts) so thin data never produces false confidence.
// All durations are in hours; defect probabilities are 0..1 rates.
//
// This module is browser-safe (no node imports): the settings UI validates
// drafts with the same schema the server enforces. File loading and hashing
// live in config.ts.

import { z } from "zod";
import type { ChangeType } from "../schema/domain.js";
import type { PolicyRules } from "../policy/policy.js";
import { DEFAULT_POLICY } from "../policy/policy.js";
import { categoryGlobs } from "../policy/categories.js";
import type { JevConfig } from "../signals/config.js";
import { DEFAULT_JEV_CONFIG, jevConfigSchema, resolveJevConfig } from "../signals/config.js";
import type { GuardrailsConfig } from "./guardrails.js";
import { DEFAULT_GUARDRAILS, globSchema, guardrailsSchema, resolveGuardrails } from "./guardrails.js";
import type { ActionAuthority } from "../actions/authority.js";
import { DEFAULT_AUTHORITY, actionsSchema, resolveAuthority } from "../actions/authority.js";
import { REVIEW_FOCUS_LIMITS, screenFreeText } from "./screen.js";
import type { SeverityConfig } from "./severity.js";
import { DEFAULT_SEVERITY, resolveSeverity, severitySchema } from "./severity.js";
import type { ReviewRule } from "./rules.js";
import { rulesSchema } from "./rules.js";
import type { ChecksConfig } from "./checks.js";
import { DEFAULT_CHECKS, checksSchema, resolveChecks } from "./checks.js";
import type { InlineConfig } from "./inline.js";
import { DEFAULT_INLINE, inlineSchema, resolveInline } from "./inline.js";
import type { WalkthroughConfig } from "./walkthroughs.js";
import { DEFAULT_WALKTHROUGHS, resolveWalkthroughs, walkthroughsSchema } from "./walkthroughs.js";
import type { LintConfig } from "./lint.js";
import { DEFAULT_LINT, lintSchema, resolveLint } from "./lint.js";
import type { VerifyConfig } from "./verify.js";
import { DEFAULT_VERIFY, resolveVerify, verifySchema } from "./verify.js";
import type { OutcomesConfig } from "./outcomes.js";
import { DEFAULT_OUTCOMES, outcomesSchema, resolveOutcomes } from "./outcomes.js";

export const PRESET_IDS = ["conservative", "balanced", "fast-lane"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface CostPriors {
  /** r_v — value lost (dev-hours) per hour this change's merge is delayed. */
  readonly valueDelayRatePerHour: number;
  /** T_cold — wait after which the author pays a cold-start re-orientation cost. */
  readonly coldStartThresholdHours: number;
  /** Δ_ctx — the cold-start cost itself, in dev-hours. */
  readonly coldStartCostHours: number;
  /** Expected merge-conflict probability per week of wait (0..1). */
  readonly conflictRatePerWeek: number;
  /** Dev-hours to resolve a merge conflict once it happens. */
  readonly conflictResolutionHours: number;
  /** Defect cost multiplier: caught in production vs at review (1:10:100 prior). */
  readonly escalationMultiplier: number;
  /** Prior dev-hours of rework a shipped defect causes (measured from repo when possible). */
  readonly defectReworkHours: number;
  /** Prior base defect probability for an unknown change type. */
  readonly defectPrior: number;
  /** Prior base defect probability per change type (repo data shrinks toward these). */
  readonly defectPriorByType: Readonly<Record<ChangeType, number>>;
  /** Pseudo-count k for Bayesian shrinkage of measured defect rates. */
  readonly defectPriorWeight: number;
  /** Pseudo-count for per-type shrinkage toward its type prior. */
  readonly typeDefectPriorWeight: number;
  /** T_review — the hour-scale on which review efficacy saturates (g(w) = 1 − e^(−w/T)). */
  readonly reviewWindowHours: number;
  /** Prior review efficacy (fraction of ship-risk review removes at full review). */
  readonly efficacyPrior: number;
  /** Pseudo-count for efficacy shrinkage. */
  readonly efficacyPriorWeight: number;
  /** Days after merge we look back for defect proxies (revert/hotfix/follow-up fix/reopen). */
  readonly defectProxyWindowDays: number;
  /** How strongly queue depth κ inflates the value-delay rate: r_v_eff = r_v·(1 + k·(κ−1)). */
  readonly delayCongestionWeight: number;
  /** How strongly queue depth κ damps review efficacy: e_max_eff = e_max/(1 + k·κ). */
  readonly efficacyCongestionWeight: number;
  /** Prior value of a change (dev-hours), per type. Feeds the net-value reject branch. */
  readonly changeValueHoursByType: Readonly<Record<ChangeType, number>>;
  /** Value fallback for types missing from changeValueHoursByType. */
  readonly defaultChangeValueHours: number;
  /** Hard cap on w* (hours) — never recommend waiting past this. */
  readonly maxWaitHoursCap: number;
  /** Floor on w* (hours) — never auto-approve instantly. */
  readonly minWaitHours: number;
}

export const DEFAULT_PRIORS: CostPriors = {
  valueDelayRatePerHour: 0.1,
  coldStartThresholdHours: 24,
  coldStartCostHours: 2,
  conflictRatePerWeek: 0.2,
  conflictResolutionHours: 1.5,
  escalationMultiplier: 15,
  defectReworkHours: 8,
  defectPrior: 0.05,
  defectPriorByType: {
    feature: 0.06,
    bugfix: 0.08,
    dependency: 0.03,
    refactor: 0.05,
    docs: 0.01,
    other: 0.05,
  },
  defectPriorWeight: 20,
  typeDefectPriorWeight: 15,
  reviewWindowHours: 24,
  efficacyPrior: 0.5,
  efficacyPriorWeight: 10,
  defectProxyWindowDays: 14,
  delayCongestionWeight: 0.15,
  efficacyCongestionWeight: 0.1,
  changeValueHoursByType: {
    feature: 24,
    bugfix: 16,
    dependency: 8,
    refactor: 8,
    docs: 2,
    other: 4,
  },
  defaultChangeValueHours: 8,
  maxWaitHoursCap: 24 * 21,
  minWaitHours: 1,
};

const changeTypeSchema = z.enum(["feature", "bugfix", "dependency", "refactor", "docs", "other"]);

/** Validated partial priors as accepted by `pullup.config.json`. */
export const configFileSchema = z
  .object({
    valueDelayRatePerHour: z.number().min(0).optional(),
    coldStartThresholdHours: z.number().min(0).optional(),
    coldStartCostHours: z.number().min(0).optional(),
    conflictRatePerWeek: z.number().min(0).max(1).optional(),
    conflictResolutionHours: z.number().min(0).optional(),
    escalationMultiplier: z.number().min(1).optional(),
    defectReworkHours: z.number().min(0).optional(),
    defectPrior: z.number().min(0).max(1).optional(),
    defectPriorByType: z
      .record(changeTypeSchema, z.number().min(0).max(1))
      .optional(),
    defectPriorWeight: z.number().min(0).optional(),
    typeDefectPriorWeight: z.number().min(0).optional(),
    reviewWindowHours: z.number().min(0).optional(),
    efficacyPrior: z.number().min(0).max(1).optional(),
    efficacyPriorWeight: z.number().min(0).optional(),
    defectProxyWindowDays: z.number().min(1).optional(),
    delayCongestionWeight: z.number().min(0).optional(),
    efficacyCongestionWeight: z.number().min(0).optional(),
    changeValueHoursByType: z
      .record(changeTypeSchema, z.number().min(0))
      .optional(),
    defaultChangeValueHours: z.number().min(0).optional(),
    maxWaitHoursCap: z.number().min(0).optional(),
    minWaitHours: z.number().min(0).optional(),
    /** Jev risk layer (see signals/config.ts). Not a cost prior. */
    jev: jevConfigSchema.optional(),
    /**
     * Deterministic policy layer (see policy/policy.ts). `requireHumanGlobs` are
     * extra critical-tier paths, added to the enabled guardrail categories.
     */
    policy: z
      .object({
        requireHumanGlobs: z.array(globSchema).max(50).optional(),
        lockfileWithoutManifest: z.boolean().optional(),
        allowlist: z
          .object({ docs: z.array(globSchema).max(50).optional(), test: z.array(globSchema).max(50).optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /** Approval envelope (see config/guardrails.ts). */
    guardrails: guardrailsSchema.optional(),
    /** What PullUp may send per decision (see actions/authority.ts). */
    actions: actionsSchema.optional(),
    /** What PullUp does about P0 / P1 / P2 findings (see config/severity.ts). */
    severity: severitySchema.optional(),
    /** Scoped rules for folders / authors / labels (see config/rules.ts). */
    rules: rulesSchema.optional(),
    /** The GitHub Check run PullUp posts per head (see config/checks.ts). */
    checks: checksSchema.optional(),
    /** Inline finding comments on the diff (see config/inline.ts). */
    inline: inlineSchema.optional(),
    /** Links to walkthrough files (such as diffmap specs) in the decision comment (see config/walkthroughs.ts). */
    walkthroughs: walkthroughsSchema.optional(),
    /** Evidence verifier for strong risk-signal findings (see config/verify.ts). */
    verify: verifySchema.optional(),
    /** The repo's own lint rules in Gallant's format (see config/lint.ts). */
    lint: lintSchema.optional(),
    /** Windows for judging what humans did after a decision (see config/outcomes.ts). */
    outcomes: outcomesSchema.optional(),
    /** Owner's review focus: context for the rationale writer only, never for decisions. */
    review: z
      .object({
        focus: z
          .string()
          .superRefine((t, ctx) => {
            for (const p of screenFreeText(t, REVIEW_FOCUS_LIMITS).problems) {
              ctx.addIssue({ code: "custom", message: `Review focus ${p}.` });
            }
          })
          .optional(),
      })
      .strict()
      .optional(),
    /** Which preset the owner started from (a UI marker; never applied implicitly). */
    preset: z.enum(PRESET_IDS).nullable().optional(),
  })
  .strict();

export type ConfigFile = z.infer<typeof configFileSchema>;

export function resolvePriors(fullFile: ConfigFile = {}): CostPriors {
  // Layer blocks configure layers, not priors — keep them out of CostPriors.
  const {
    jev: _jev,
    policy: _policy,
    guardrails: _guardrails,
    actions: _actions,
    severity: _severity,
    rules: _rules,
    checks: _checks,
    inline: _inline,
    walkthroughs: _walkthroughs,
    verify: _verify,
    lint: _lint,
    outcomes: _outcomes,
    review: _review,
    preset: _preset,
    ...file
  } = fullFile;
  const changeValueHoursByType = {
    ...DEFAULT_PRIORS.changeValueHoursByType,
    ...file.changeValueHoursByType,
  };
  const defectPriorByType = {
    ...DEFAULT_PRIORS.defectPriorByType,
    ...file.defectPriorByType,
  };
  return {
    ...DEFAULT_PRIORS,
    ...file,
    changeValueHoursByType,
    defectPriorByType,
  };
}

/**
 * The effective policy. Without guardrails this is the legacy resolution
 * (file globs replace the defaults). With guardrails, the enabled categories
 * supply the critical globs and file globs are added on top; test-only paths
 * leave the trivial tier when `testOnlyFastPath` is off.
 */
export function resolvePolicy(file: ConfigFile["policy"] = {}, guardrails?: GuardrailsConfig): PolicyRules {
  const allowlist = {
    docs: file.allowlist?.docs ?? DEFAULT_POLICY.allowlist.docs,
    test: file.allowlist?.test ?? DEFAULT_POLICY.allowlist.test,
  };
  if (!guardrails) {
    return {
      requireHumanGlobs: file.requireHumanGlobs ?? DEFAULT_POLICY.requireHumanGlobs,
      lockfileWithoutManifest: file.lockfileWithoutManifest ?? DEFAULT_POLICY.lockfileWithoutManifest,
      allowlist,
    };
  }
  return {
    requireHumanGlobs: [...new Set([...categoryGlobs(guardrails.requireHumanCategories), ...(file.requireHumanGlobs ?? [])])],
    lockfileWithoutManifest: file.lockfileWithoutManifest ?? DEFAULT_POLICY.lockfileWithoutManifest,
    allowlist: { docs: allowlist.docs, test: guardrails.tests.testOnlyFastPath ? allowlist.test : [] },
  };
}

/** Everything a config file resolves to (no file path / version / hash). */
export interface ResolvedLayers {
  readonly priors: CostPriors;
  readonly jev: JevConfig;
  readonly policy: PolicyRules;
  readonly guardrails: GuardrailsConfig;
  readonly authority: ActionAuthority;
  readonly severity: SeverityConfig;
  readonly rules: readonly ReviewRule[];
  readonly checks: ChecksConfig;
  readonly inline: InlineConfig;
  readonly walkthroughs: WalkthroughConfig;
  readonly verify: VerifyConfig;
  readonly lint: LintConfig;
  readonly outcomes: OutcomesConfig;
  /** Normalised review focus, or null. */
  readonly reviewFocus: string | null;
}

export function resolveConfigFile(file: ConfigFile = {}): ResolvedLayers {
  const guardrails = resolveGuardrails(file.guardrails);
  const focus = file.review?.focus ? screenFreeText(file.review.focus, REVIEW_FOCUS_LIMITS).normalized : "";
  return {
    priors: resolvePriors(file),
    jev: resolveJevConfig(file.jev),
    policy: resolvePolicy(file.policy, guardrails),
    guardrails,
    authority: resolveAuthority(file.actions),
    severity: resolveSeverity(file.severity),
    rules: (file.rules ?? []) as ReviewRule[],
    checks: resolveChecks(file.checks),
    inline: resolveInline(file.inline),
    walkthroughs: resolveWalkthroughs(file.walkthroughs),
    verify: resolveVerify(file.verify),
    lint: resolveLint(file.lint),
    outcomes: resolveOutcomes(file.outcomes),
    reviewFocus: focus === "" ? null : focus,
  };
}

export type ConfigSource = "default" | "file" | "repo";

export interface ResolvedConfig extends ResolvedLayers {
  readonly path: string | null;
  /** Human-readable list of top-level fields that came from the file. */
  readonly fileOverrides: readonly string[];
  /** The raw file layer (validated). */
  readonly file: ConfigFile;
  /** The raw repo layer (a saved config version), when one applies. */
  readonly repo: ConfigFile | null;
  /** Repo config version, or null when only file/defaults apply. */
  readonly version: number | null;
  /** sha256 of the canonical effective config. */
  readonly hash: string;
  /** Leaf path → which layer set it. */
  readonly sources: Readonly<Record<string, ConfigSource>>;
}

/** The full default config in file shape — what the settings UI edits against. */
export function defaultConfigFile(): ConfigFile {
  const j = DEFAULT_JEV_CONFIG;
  const g = DEFAULT_GUARDRAILS;
  return {
    ...(DEFAULT_PRIORS as unknown as ConfigFile),
    defectPriorByType: { ...DEFAULT_PRIORS.defectPriorByType },
    changeValueHoursByType: { ...DEFAULT_PRIORS.changeValueHoursByType },
    jev: {
      mode: j.mode,
      model: j.model,
      questionSet: j.questionSet,
      thresholds: { ...j.thresholds },
      multiplierMin: j.multiplierMin,
      multiplierMax: j.multiplierMax,
      calibrationPath: j.calibrationPath,
      budgetUsdPerRun: j.budgetUsdPerRun,
      concurrency: j.concurrency,
      requestsPerMinute: j.requestsPerMinute,
      humanReviewers: [],
      customQuestions: [],
      disabledQuestions: [],
      gate: { ...j.gate },
    },
    policy: {
      requireHumanGlobs: [],
      lockfileWithoutManifest: DEFAULT_POLICY.lockfileWithoutManifest,
      allowlist: { docs: [...DEFAULT_POLICY.allowlist.docs], test: [...DEFAULT_POLICY.allowlist.test] },
    },
    guardrails: {
      maxAutoApproveLines: g.maxAutoApproveLines,
      maxAutoApproveFiles: g.maxAutoApproveFiles,
      sizeExcludeGlobs: [...g.sizeExcludeGlobs],
      requireHumanCategories: { ...g.requireHumanCategories } as never,
      tiers: { low: [], high: [] },
      approveMaxTier: g.approveMaxTier,
      dependencies: { autoApprove: [...g.dependencies.autoApprove], minReleaseAgeDays: g.dependencies.minReleaseAgeDays },
      tests: { ...g.tests },
      authors: { aiAuthors: [], aiSizeMultiplier: g.authors.aiSizeMultiplier, trustedBots: [...g.authors.trustedBots] },
      freezeWindows: [],
    },
    actions: { ...DEFAULT_AUTHORITY },
    severity: {
      actions: { ...DEFAULT_SEVERITY.actions },
      signalsCanRequestChanges: DEFAULT_SEVERITY.signalsCanRequestChanges,
      questionLevels: {},
    },
    rules: [],
    checks: { ...DEFAULT_CHECKS },
    inline: { ...DEFAULT_INLINE },
    walkthroughs: { ...DEFAULT_WALKTHROUGHS, paths: [...DEFAULT_WALKTHROUGHS.paths] },
    verify: { ...DEFAULT_VERIFY },
    lint: { ...DEFAULT_LINT },
    outcomes: { ...DEFAULT_OUTCOMES },
    review: { focus: "" },
    preset: null,
  };
}

/** Defaults < file < repo, in file shape — what the settings UI displays and diffs. */
export function effectiveConfigFile(file: ConfigFile = {}, repo: ConfigFile | null = null): ConfigFile {
  return mergeConfig<ConfigFile>(defaultConfigFile(), file, repo);
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Deep merge of config layers: objects merge, arrays and scalars (incl. null) replace. */
export function mergeConfig<T extends Record<string, unknown>>(...layers: ReadonlyArray<T | null | undefined>): T {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined) continue;
      out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeConfig(out[k] as T, v as T) : structuredCloneish(v);
    }
  }
  return out as T;
}

function structuredCloneish(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(structuredCloneish);
  if (isPlainObject(v)) return mergeConfig(v);
  return v;
}

/**
 * Leaf paths of a config object: scalars, nulls and arrays are leaves
 * ("guardrails.maxAutoApproveLines", "policy.allowlist.docs").
 */
export function flattenConfig(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && k !== "weights") Object.assign(out, flattenConfig(v, path));
    else out[path] = v;
  }
  return out;
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Returns a copy of `obj` with `path` set to `value` (creating objects as needed). */
export function setPath<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
  const parts = path.split(".");
  const root: Record<string, unknown> = mergeConfig(obj);
  let cur = root;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cur[part])) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts.at(-1)!] = value;
  return root as T;
}

/** Returns a copy of `obj` without `path` (pruning emptied parents). */
export function unsetPath<T extends Record<string, unknown>>(obj: T, path: string): T {
  const parts = path.split(".");
  const root: Record<string, unknown> = mergeConfig(obj);
  const stack: Array<Record<string, unknown>> = [root];
  let cur = root;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cur[part])) return root as T;
    cur = cur[part] as Record<string, unknown>;
    stack.push(cur);
  }
  delete cur[parts.at(-1)!];
  for (let i = stack.length - 1; i > 0; i--) {
    if (Object.keys(stack[i]!).length === 0) delete stack[i - 1]![parts[i - 1]!];
  }
  return root as T;
}

/** Which layer set each effective leaf. */
export function configSources(file: ConfigFile, repo: ConfigFile | null): Record<string, ConfigSource> {
  const out: Record<string, ConfigSource> = {};
  const f = flattenConfig(file as Record<string, unknown>);
  const r = flattenConfig((repo ?? {}) as Record<string, unknown>);
  for (const path of Object.keys(flattenConfig(defaultConfigFile() as Record<string, unknown>))) {
    out[path] = path in r ? "repo" : path in f ? "file" : "default";
  }
  for (const path of Object.keys(f)) if (!(path in out)) out[path] = path in r ? "repo" : "file";
  for (const path of Object.keys(r)) out[path] = "repo";
  return out;
}

/** Deterministic JSON with sorted keys — the basis of the config hash. */
export function canonicalJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(",")}]`;
  if (isPlainObject(x)) {
    return `{${Object.keys(x)
      .filter((k) => x[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(x[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}
