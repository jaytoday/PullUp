// Scoped review rules ("Special cases"): adjust the repo policy for specific
// folders, authors or labels. The repo policy stays the simple default; rules
// are optional overrides on top.
//
// Safety rule: a rule matched by only *some* of a PR's files can only make the
// gate stricter. A rule may loosen only when every changed file is inside its
// folders, or when it's scoped purely by author/label — otherwise touching
// docs/ plus src/auth/ would inherit the docs leniency.
//
// Combination: base policy → loosen-capable rules in list order (later wins) →
// stricter-only rules (strictest value per field). Browser-safe.

import { z } from "zod";
import { matchesAny } from "../policy/policy.js";
import { SIZE_MAX, SIZE_STEP, FILES_MAX, globSchema } from "./guardrails.js";
import type { GuardrailsConfig } from "./guardrails.js";
import type { SeverityActions, SeverityConfig, SeverityLevel } from "./severity.js";
import { ACTION_STRICTNESS, SEVERITY_LEVELS, severityActionsSchema, stricterAction } from "./severity.js";

export interface RuleWhen {
  /** Globs; with `pathMatch: "all"` every changed file must match, else any one. */
  readonly paths?: readonly string[];
  readonly pathMatch?: "any" | "all";
  /** Login globs (e.g. "renovate[bot]", "intern-*"). */
  readonly authors?: readonly string[];
  readonly labels?: readonly string[];
}

export interface RuleSet {
  readonly requireHuman?: boolean;
  readonly noAutoApprove?: boolean;
  readonly requireTests?: boolean;
  readonly maxLines?: number | null;
  readonly maxFiles?: number | null;
  readonly severity?: Partial<Record<SeverityLevel, SeverityActions[SeverityLevel]>>;
  /** Extra reviewers requested when PullUp asks a human for a matching PR. */
  readonly reviewers?: readonly string[];
}

export interface ReviewRule {
  readonly name: string;
  readonly when: RuleWhen;
  readonly set: RuleSet;
}

/** The per-PR policy after rules. */
export interface ScopedPolicy {
  readonly maxLines: number | null;
  readonly maxFiles: number | null;
  readonly requireTests: boolean;
  /** Names of matched rules that require a human. */
  readonly requireHuman: readonly string[];
  /** Names of matched rules that forbid auto-approval. */
  readonly noAutoApprove: readonly string[];
  readonly actions: SeverityActions;
  readonly extraReviewers: readonly string[];
}

export interface AppliedRule {
  readonly name: string;
  /** "override" may loosen; "stricter" only tightens (partial path match). */
  readonly mode: "override" | "stricter";
}

const login = z.string().regex(/^[A-Za-z0-9*][A-Za-z0-9*._-]{0,38}(?:\[bot\])?$/, "not a GitHub login (wildcards * allowed)");
const reviewer = z.string().regex(/^@?[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\/[A-Za-z0-9._-]{1,100})?$/, "not a GitHub user or org/team");
const label = z.string().min(1).max(50).regex(/^[^\u0000-\u001F<>]+$/, "label has unsupported characters");
const limit = (max: number, step: number) =>
  z
    .number()
    .int()
    .min(step === 1 ? 1 : 0)
    .max(max)
    .refine((n) => n % step === 0, `must be a multiple of ${step}`)
    .nullable();

export const ruleSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give the rule a name.")
      .max(60)
      .regex(/^[A-Za-z0-9 _.,:()'&/+-]+$/, "Rule names use letters, numbers and simple punctuation."),
    when: z
      .object({
        paths: z.array(globSchema).max(20).optional(),
        pathMatch: z.enum(["any", "all"]).optional(),
        authors: z.array(login).max(20).optional(),
        labels: z.array(label).max(20).optional(),
      })
      .strict()
      .refine(
        (w) => (w.paths?.length ?? 0) + (w.authors?.length ?? 0) + (w.labels?.length ?? 0) > 0,
        "A rule needs at least one condition (files, authors or labels).",
      ),
    set: z
      .object({
        requireHuman: z.boolean().optional(),
        noAutoApprove: z.boolean().optional(),
        requireTests: z.boolean().optional(),
        maxLines: limit(SIZE_MAX, SIZE_STEP).optional(),
        maxFiles: limit(FILES_MAX, 1).optional(),
        severity: severityActionsSchema.optional(),
        reviewers: z.array(reviewer).max(10).optional(),
      })
      .strict()
      .refine((s) => Object.values(s).some((v) => v !== undefined), "A rule needs at least one effect."),
  })
  .strict();

export const rulesSchema = z
  .array(ruleSchema)
  .max(20, "At most 20 rules.")
  .refine((rs) => new Set(rs.map((r) => r.name.trim().toLowerCase())).size === rs.length, "Rule names must be unique.");

export interface RuleSubject {
  readonly files: readonly string[];
  readonly author: string;
  readonly labels: readonly string[];
}

function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
  return re.test(value);
}

/** Whether a rule may loosen at all: only when not scoped by a partial path match. */
export function canLoosen(rule: Pick<ReviewRule, "when">): boolean {
  return !rule.when.paths?.length || rule.when.pathMatch === "all";
}

export function matchRule(rule: ReviewRule, s: RuleSubject): AppliedRule | null {
  const w = rule.when;
  if (w.paths?.length) {
    const hit = (f: string) => matchesAny(f, w.paths!) !== null;
    const ok = w.pathMatch === "all" ? s.files.length > 0 && s.files.every(hit) : s.files.some(hit);
    if (!ok) return null;
  }
  if (w.authors?.length && !w.authors.some((a) => globMatch(a, s.author))) return null;
  if (w.labels?.length && !w.labels.some((l) => s.labels.some((x) => x.toLowerCase() === l.toLowerCase()))) return null;
  return { name: rule.name, mode: canLoosen(rule) ? "override" : "stricter" };
}

function stricterLimit(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

export function basePolicy(g: GuardrailsConfig, sev: SeverityConfig): ScopedPolicy {
  return {
    maxLines: g.maxAutoApproveLines,
    maxFiles: g.maxAutoApproveFiles,
    requireTests: g.tests.requireForBehaviorChange,
    requireHuman: [],
    noAutoApprove: [],
    actions: sev.actions,
    extraReviewers: [],
  };
}

function applyOne(p: ScopedPolicy, rule: ReviewRule, mode: AppliedRule["mode"]): ScopedPolicy {
  const s = rule.set;
  const strict = mode === "stricter";
  // Both inputs are valid per level, so the stricter/override result stays valid.
  const actions = { ...p.actions } as Record<SeverityLevel, SeverityActions[SeverityLevel]>;
  for (const lvl of SEVERITY_LEVELS) {
    const v = s.severity?.[lvl];
    if (v === undefined) continue;
    actions[lvl] = strict ? stricterAction(actions[lvl], v) : v;
  }
  return {
    maxLines: s.maxLines === undefined ? p.maxLines : strict ? stricterLimit(p.maxLines, s.maxLines) : s.maxLines,
    maxFiles: s.maxFiles === undefined ? p.maxFiles : strict ? stricterLimit(p.maxFiles, s.maxFiles) : s.maxFiles,
    requireTests: s.requireTests === undefined ? p.requireTests : strict ? p.requireTests || s.requireTests : s.requireTests,
    requireHuman: s.requireHuman ? [...p.requireHuman, rule.name] : p.requireHuman,
    noAutoApprove: s.noAutoApprove ? [...p.noAutoApprove, rule.name] : p.noAutoApprove,
    actions: actions as SeverityActions,
    extraReviewers: [...new Set([...p.extraReviewers, ...(s.reviewers ?? [])])],
  };
}

/** The PR's effective policy and which rules applied (in the order they were applied). */
export function applyRules(
  base: ScopedPolicy,
  rules: readonly ReviewRule[],
  subject: RuleSubject,
): { policy: ScopedPolicy; applied: AppliedRule[] } {
  const matched = rules
    .map((r) => ({ r, m: matchRule(r, subject) }))
    .filter((x): x is { r: ReviewRule; m: AppliedRule } => x.m !== null);
  let policy = base;
  for (const { r, m } of matched.filter((x) => x.m.mode === "override")) policy = applyOne(policy, r, "override");
  for (const { r, m } of matched.filter((x) => x.m.mode === "stricter")) policy = applyOne(policy, r, "stricter");
  return {
    policy,
    applied: [...matched.filter((x) => x.m.mode === "override"), ...matched.filter((x) => x.m.mode === "stricter")].map((x) => x.m),
  };
}

const looserLimit = (rule: number | null | undefined, base: number | null) =>
  rule !== undefined && (rule === null ? base !== null : base !== null && rule > base);

/** Does this rule make anything looser than the base policy (for the save diff)? */
export function ruleLoosens(rule: ReviewRule, g: GuardrailsConfig, sev: SeverityConfig): boolean {
  if (!canLoosen(rule)) return false;
  const s = rule.set;
  if (looserLimit(s.maxLines, g.maxAutoApproveLines) || looserLimit(s.maxFiles, g.maxAutoApproveFiles)) return true;
  if (s.requireTests === false && g.tests.requireForBehaviorChange) return true;
  return SEVERITY_LEVELS.some((l) => s.severity?.[l] !== undefined && ACTION_STRICTNESS[s.severity[l]!] < ACTION_STRICTNESS[sev.actions[l]]);
}

/** Does this rule make anything stricter (so removing it loosens)? */
export function ruleTightens(rule: ReviewRule, g: GuardrailsConfig, sev: SeverityConfig): boolean {
  const s = rule.set;
  if (s.requireHuman || s.noAutoApprove) return true;
  if (s.requireTests && !g.tests.requireForBehaviorChange) return true;
  const tighterLimit = (r: number | null | undefined, b: number | null) => r !== undefined && r !== null && (b === null || r < b);
  if (tighterLimit(s.maxLines, g.maxAutoApproveLines) || tighterLimit(s.maxFiles, g.maxAutoApproveFiles)) return true;
  return SEVERITY_LEVELS.some((l) => s.severity?.[l] !== undefined && ACTION_STRICTNESS[s.severity[l]!] > ACTION_STRICTNESS[sev.actions[l]]);
}

/** One-line, plain-language summary of a rule ("files in src/billing/** → always a human; P1 → request changes"). */
export function describeRule(rule: ReviewRule): string {
  const w = rule.when;
  const cond: string[] = [];
  if (w.paths?.length) cond.push(`${w.pathMatch === "all" ? "every file in" : "files in"} ${w.paths.join(", ")}`);
  if (w.authors?.length) cond.push(`author ${w.authors.join(" / ")}`);
  if (w.labels?.length) cond.push(`label ${w.labels.join(" / ")}`);
  const s = rule.set;
  const eff: string[] = [];
  if (s.requireHuman) eff.push("always a human");
  if (s.noAutoApprove) eff.push("never auto-approve");
  if (s.requireTests !== undefined) eff.push(s.requireTests ? "require tests" : "tests optional");
  if (s.maxLines !== undefined) eff.push(s.maxLines === null ? "no line limit" : `≤ ${s.maxLines} lines`);
  if (s.maxFiles !== undefined) eff.push(s.maxFiles === null ? "no file limit" : `≤ ${s.maxFiles} files`);
  for (const l of SEVERITY_LEVELS) if (s.severity?.[l]) eff.push(`${l.toUpperCase()} → ${s.severity[l]!.replace("-", " ")}`);
  if (s.reviewers?.length) eff.push(`also ask ${s.reviewers.join(", ")}`);
  return `${cond.join(" and ") || "—"} → ${eff.join("; ") || "no effect"}`;
}

/** Starting points for the "Add rule" menu. */
export const RULE_TEMPLATES: ReadonlyArray<{ id: string; label: string; blurb: string; rule: ReviewRule }> = [
  {
    id: "stricter-folder",
    label: "Stricter folder",
    blurb: "Any change in a sensitive folder always gets a person.",
    rule: { name: "Sensitive folder", when: { paths: ["src/billing/**"], pathMatch: "any" }, set: { requireHuman: true, severity: { p1: "request-changes" } } },
  },
  {
    id: "trusted-author",
    label: "Trusted author",
    blurb: "Maintainers get a larger size limit.",
    rule: { name: "Maintainers", when: { authors: ["alice"] }, set: { maxLines: 600 } },
  },
  {
    id: "new-contributors",
    label: "New or AI authors",
    blurb: "Stricter limits for specific authors or bots.",
    rule: { name: "AI agents", when: { authors: ["copilot*"] }, set: { maxLines: 100, requireTests: true } },
  },
  {
    id: "docs-only",
    label: "Docs-only PRs",
    blurb: "When every changed file is docs, minor findings never block.",
    rule: { name: "Docs only", when: { paths: ["docs/**", "**/*.md"], pathMatch: "all" }, set: { severity: { p1: "note" } } },
  },
];
