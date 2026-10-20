// The settings field registry: one entry per configurable leaf, with its
// label, help, widget hints and — the important part — which direction of
// change *loosens* the gate. The UI renders controls from it and the save
// dialog labels each change "loosens" / "tightens" from it, so validation,
// controls and diff labels can't drift apart. Browser-safe.

import type { ActionAuthority, AuthorityLevel } from "../actions/authority.js";
import { ACTION_LABEL, AUTHORITY_RANK, approvesWithoutBlocking } from "../actions/authority.js";
import { REQUIRE_HUMAN_CATEGORIES } from "../policy/categories.js";
import { APPROVABLE_TIERS, FILES_MAX, SIZE_MAX, SIZE_STEP } from "./guardrails.js";
import type { ConfigFile } from "./schema.js";
import { flattenConfig, getPath, resolveConfigFile } from "./schema.js";
import type { ReviewRule } from "./rules.js";
import { describeRule, ruleLoosens, ruleTightens } from "./rules.js";

/**
 * Which change loosens the gate:
 *   higher/lower — numeric (null = "no limit" when `nullIsUnlimited`)
 *   false/true   — a boolean turned to this value loosens
 *   shrink/grow  — a list losing / gaining entries loosens
 *   rank         — an ordered enum moving up loosens (authority, approvable tier)
 *   neutral      — a change worth listing, but neither direction
 */
export type Loosens = "higher" | "lower" | "false" | "true" | "shrink" | "grow" | "rank" | "neutral";

export type FieldWidget = "slider" | "number" | "switch" | "select" | "globs" | "chips" | "text" | "authority";

export type FieldGroup =
  | "mode"
  | "limits"
  | "requireHuman"
  | "reviewers"
  | "focus"
  | "paths"
  | "dependencies"
  | "tests"
  | "authors"
  | "freeze"
  | "signals"
  | "questions"
  | "economics-waiting"
  | "economics-defects"
  | "economics-efficacy"
  | "economics-value"
  | "gates"
  | "model"
  | "severity"
  | "rules"
  | "checks"
  | "inline"
  | "verify"
  | "outcomes";

export interface FieldSpec {
  /** Dot path into the config file; `*` matches one record key. */
  readonly path: string;
  readonly label: string;
  readonly help: string;
  readonly group: FieldGroup;
  readonly widget: FieldWidget;
  readonly loosens: Loosens;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly options?: readonly string[];
  /** For `rank`: the order, lowest first. */
  readonly order?: readonly string[];
  /** null means "no limit" (treated as +∞ when comparing). */
  readonly nullIsUnlimited?: boolean;
  /** Shown but inert until data exists (e.g. release age). */
  readonly inert?: string;
}

const AUTH_ORDER = ["off", "comment", "act"] as const;

const PRIOR_FIELDS: ReadonlyArray<Omit<FieldSpec, "widget" | "loosens"> & { readonly loosens?: Loosens }> = [
  { path: "valueDelayRatePerHour", label: "Value lost per hour of delay", help: "Dev-hours of value lost for each hour a change waits to merge.", group: "economics-waiting", unit: "h/h", min: 0, step: 0.01 },
  { path: "coldStartThresholdHours", label: "Cold-start threshold", help: "Wait after which the author pays a re-orientation cost.", group: "economics-waiting", unit: "hours", min: 0, step: 1 },
  { path: "coldStartCostHours", label: "Cold-start cost", help: "Dev-hours to get back into a stale change.", group: "economics-waiting", unit: "dev-hours", min: 0, step: 0.5 },
  { path: "conflictRatePerWeek", label: "Merge-conflict rate", help: "Chance of a merge conflict per week of waiting.", group: "economics-waiting", unit: "/week", min: 0, max: 1, step: 0.01 },
  { path: "conflictResolutionHours", label: "Conflict resolution cost", help: "Dev-hours to resolve one merge conflict.", group: "economics-waiting", unit: "dev-hours", min: 0, step: 0.5 },
  { path: "escalationMultiplier", label: "Production defect multiplier", help: "How much more a defect costs in production than at review (the 1:10:100 prior).", group: "economics-defects", unit: "×", min: 1, step: 1 },
  { path: "defectReworkHours", label: "Defect rework", help: "Prior dev-hours of rework a shipped defect causes.", group: "economics-defects", unit: "dev-hours", min: 0, step: 1 },
  { path: "defectPrior", label: "Base defect rate", help: "Prior defect probability for an unknown change type.", group: "economics-defects", min: 0, max: 1, step: 0.01 },
  { path: "defectPriorByType.*", label: "Defect rate by type", help: "Prior defect probability per change type.", group: "economics-defects", min: 0, max: 1, step: 0.01 },
  { path: "defectPriorWeight", label: "Defect prior weight", help: "Pseudo-count: how much repo data is needed to move off the prior.", group: "economics-defects", min: 0, step: 1 },
  { path: "typeDefectPriorWeight", label: "Per-type prior weight", help: "Pseudo-count for per-type shrinkage.", group: "economics-defects", min: 0, step: 1 },
  { path: "defectProxyWindowDays", label: "Defect look-back window", help: "Days after merge in which a revert/hotfix counts as a defect.", group: "economics-defects", unit: "days", min: 1, step: 1 },
  { path: "reviewWindowHours", label: "Review saturation window", help: "Hours over which review efficacy saturates.", group: "economics-efficacy", unit: "hours", min: 0, step: 1 },
  { path: "efficacyPrior", label: "Review efficacy prior", help: "Fraction of ship-risk a full review removes.", group: "economics-efficacy", min: 0, max: 1, step: 0.05 },
  { path: "efficacyPriorWeight", label: "Efficacy prior weight", help: "Pseudo-count for efficacy shrinkage.", group: "economics-efficacy", min: 0, step: 1 },
  { path: "delayCongestionWeight", label: "Congestion → delay cost", help: "How strongly queue depth inflates the delay cost.", group: "economics-efficacy", min: 0, step: 0.05 },
  { path: "efficacyCongestionWeight", label: "Congestion → review efficacy", help: "How strongly queue depth damps review efficacy.", group: "economics-efficacy", min: 0, step: 0.05 },
  { path: "changeValueHoursByType.*", label: "Change value by type", help: "Prior value (dev-hours) of a change, per type.", group: "economics-value", unit: "dev-hours", min: 0, step: 1 },
  { path: "defaultChangeValueHours", label: "Default change value", help: "Value fallback for unknown change types.", group: "economics-value", unit: "dev-hours", min: 0, step: 1 },
  { path: "maxWaitHoursCap", label: "Longest wait", help: "Never recommend waiting longer than this.", group: "economics-value", unit: "hours", min: 0, step: 12 },
  { path: "minWaitHours", label: "Shortest wait", help: "Never auto-approve sooner than this.", group: "economics-value", unit: "hours", min: 0, step: 1, loosens: "lower" },
];

export const FIELDS: readonly FieldSpec[] = [
  // Mode (authority per action)
  ...(["approve", "requestChanges", "requestHuman"] as const).map(
    (k): FieldSpec => ({
      path: `actions.${k}`,
      label: `${ACTION_LABEL[k]}: authority`,
      help: "Off = silent · Comment = one PullUp comment · Act = the real review action.",
      group: "mode",
      widget: "authority",
      loosens: k === "approve" ? "rank" : "neutral",
      order: AUTH_ORDER,
      options: AUTH_ORDER,
    }),
  ),
  { path: "jev.mode", label: "Risk signals", help: "Off · Observe (shown, no effect) · Use in decisions.", group: "signals", widget: "select", loosens: "neutral", options: ["off", "shadow", "active"] },

  // Severity: what PullUp does about P0 / P1 / P2 findings (strictest first).
  { path: "severity.actions.p0", label: "P0 findings", help: "Blocking: auth, secrets, injection, unsafe schema changes.", group: "severity", widget: "select", loosens: "rank", order: ["request-changes", "ask-human"], options: ["request-changes", "ask-human"] },
  { path: "severity.actions.p1", label: "P1 findings", help: "Important: tests missing, risky but unconfirmed changes.", group: "severity", widget: "select", loosens: "rank", order: ["request-changes", "ask-human", "note"], options: ["request-changes", "ask-human", "note"] },
  { path: "severity.actions.p2", label: "P2 findings", help: "Minor: advisory, never blocks.", group: "severity", widget: "select", loosens: "rank", order: ["ask-human", "note"], options: ["ask-human", "note"] },
  { path: "severity.signalsCanRequestChanges", label: "Let model signals request changes", help: "Off: only rule-confirmed findings request changes; model signals ask a human instead. Verified: only when the evidence verifier confirmed the finding with quotes from the diff.", group: "severity", widget: "select", loosens: "neutral", options: ["false", "verified", "true"] },
  { path: "severity.questionLevels.*", label: "Question level", help: "The P-level a risk question's “yes” produces.", group: "signals", widget: "select", loosens: "rank", order: ["p0", "p1", "p2"], options: ["p0", "p1", "p2"] },
  { path: "checks.enabled", label: "Post a GitHub check", help: "One “PullUp” check per commit, with the decision and findings. Adds output only; it never makes approval easier.", group: "checks", widget: "switch", loosens: "neutral" },
  { path: "checks.name", label: "Check name", help: "The name branch protection requires. Renaming it breaks any rule that requires the old name.", group: "checks", widget: "text", loosens: "neutral" },
  { path: "checks.blockOn", label: "Fail the check when", help: "Never: the check reports, it never blocks. Request changes: the check fails when PullUp requests changes at Act.", group: "checks", widget: "select", loosens: "rank", order: ["request-changes", "never"], options: ["never", "request-changes"] },
  { path: "checks.annotations", label: "Pin findings to lines", help: "Annotate the diff lines behind each located finding.", group: "checks", widget: "switch", loosens: "neutral" },
  { path: "inline.enabled", label: "Comment on the lines behind findings", help: "Post located findings as inline review comments and resolve them when a push makes them go away. Information only: never changes the action.", group: "inline", widget: "switch", loosens: "neutral" },
  { path: "inline.reportOn", label: "Comment on findings at", help: "P0 only, P0–P1, or every level.", group: "inline", widget: "select", loosens: "neutral", options: ["p0", "p1", "p2"] },
  { path: "inline.includeObserve", label: "Comment while signals are only observed", help: "Post signal findings marked “Observe only” even though they don't count toward actions.", group: "inline", widget: "switch", loosens: "neutral" },
  { path: "inline.maxComments", label: "New comments per commit", help: "Most severe first.", group: "inline", widget: "number", loosens: "neutral", min: 1, max: 30, step: 1 },
  { path: "inline.resolveFixed", label: "Resolve fixed findings", help: "Resolve PullUp's own threads when a later push makes the finding go away. Never touches anyone else's comments.", group: "inline", widget: "switch", loosens: "neutral" },
  { path: "inline.maxResolutions", label: "Resolutions per run", help: "A cap so a bad run can't resolve everything.", group: "inline", widget: "number", loosens: "neutral", min: 1, max: 50, step: 1 },
  { path: "verify.enabled", label: "Check strong findings against the code", help: "A second, read-only model pass on P0/P1 risk-signal findings that returns quotes from the diff. It can only add friction: a confirmed finding may request changes (with “Verified” above); it never removes a finding or enables an approval.", group: "verify", widget: "switch", loosens: "neutral" },
  { path: "verify.model", label: "Verifier model", help: "The model the live verifier uses.", group: "verify", widget: "text", loosens: "neutral" },
  { path: "verify.maxPerPull", label: "Findings checked per pull request", help: "Most severe first.", group: "verify", widget: "number", loosens: "neutral", min: 1, max: 10, step: 1 },
  { path: "verify.inObserve", label: "Check while signals are only observed", help: "Verdicts are shown, never used.", group: "verify", widget: "switch", loosens: "neutral" },
  { path: "verify.budgetUsdPerDay", label: "Verifier budget per day", help: "Hard stop on live verifier spend per repo per UTC day.", group: "verify", widget: "number", loosens: "neutral", min: 0, max: 500, step: 1, unit: "USD" },
  { path: "outcomes.quickApproveMinutes", label: "Quick approval", help: "A human approving the same commit within this many minutes counts as “the ask wasn't needed”. Affects the Outcomes page only.", group: "outcomes", widget: "number", loosens: "neutral", min: 1, max: 1440, step: 5, unit: "minutes" },
  { path: "outcomes.defectWindowDays", label: "Revert window", help: "A revert or hotfix within this many days of merging counts against an approval. Affects the Outcomes page only.", group: "outcomes", widget: "number", loosens: "neutral", min: 1, max: 90, step: 1, unit: "days" },
  { path: "rules", label: "Special cases (rules)", help: "Scoped policy for folders, authors or labels.", group: "rules", widget: "text", loosens: "neutral" },

  // Basic: limits
  { path: "guardrails.maxAutoApproveLines", label: "Max lines changed", help: "Above this, PullUp can't auto-approve. Generated, vendored and lockfile paths don't count.", group: "limits", widget: "slider", loosens: "higher", min: 0, max: SIZE_MAX, step: SIZE_STEP, unit: "lines", nullIsUnlimited: true },
  { path: "guardrails.maxAutoApproveFiles", label: "Max files changed", help: "Above this, PullUp can't auto-approve.", group: "limits", widget: "slider", loosens: "higher", min: 1, max: FILES_MAX, step: 1, unit: "files", nullIsUnlimited: true },
  ...REQUIRE_HUMAN_CATEGORIES.map(
    (c): FieldSpec => ({
      path: `guardrails.requireHumanCategories.${c.id}`,
      label: `Always a human: ${c.label}`,
      help: c.help,
      group: "requireHuman",
      widget: "switch",
      loosens: "false",
    }),
  ),
  { path: "jev.humanReviewers", label: "Escalation reviewers", help: "GitHub users or org/teams requested when PullUp asks a human.", group: "reviewers", widget: "chips", loosens: "neutral" },
  { path: "review.focus", label: "Review focus", help: "Context for the rationale writer. Never affects decisions.", group: "focus", widget: "text", loosens: "neutral" },

  // Advanced: paths & tiers
  { path: "policy.allowlist.docs", label: "Trivial tier: docs paths", help: "Docs-only PRs in these paths are fast-path eligible.", group: "paths", widget: "globs", loosens: "grow" },
  { path: "policy.allowlist.test", label: "Trivial tier: test paths", help: "Test-only PRs in these paths are fast-path eligible.", group: "paths", widget: "globs", loosens: "grow" },
  { path: "guardrails.tiers.low", label: "Low tier paths", help: "Internal, non-hotspot code.", group: "paths", widget: "globs", loosens: "grow" },
  { path: "guardrails.tiers.high", label: "High tier paths", help: "Public APIs, schemas, shared libraries — never bot-approved.", group: "paths", widget: "globs", loosens: "shrink" },
  { path: "policy.requireHumanGlobs", label: "Critical tier: extra paths", help: "Always escalate to a human, on top of the categories.", group: "paths", widget: "globs", loosens: "shrink" },
  { path: "guardrails.approveMaxTier", label: "Highest approvable tier", help: "PullUp never approves PRs above this tier.", group: "paths", widget: "select", loosens: "rank", options: APPROVABLE_TIERS, order: APPROVABLE_TIERS },
  { path: "guardrails.sizeExcludeGlobs", label: "Not counted toward size", help: "Generated, vendored and lockfile paths.", group: "paths", widget: "globs", loosens: "grow" },
  { path: "policy.lockfileWithoutManifest", label: "Lockfile without manifest needs a human", help: "A lockfile changed without its manifest is a supply-chain red flag.", group: "paths", widget: "switch", loosens: "false" },

  // Dependencies
  { path: "guardrails.dependencies.autoApprove", label: "Auto-approvable updates", help: "Dependency update kinds PullUp may approve.", group: "dependencies", widget: "chips", loosens: "grow", options: ["patch:dev", "minor:dev", "patch:runtime", "minor:runtime"] },
  { path: "guardrails.dependencies.minReleaseAgeDays", label: "Minimum release age", help: "Renovate recommends 14 days so registries can pull malicious releases first.", group: "dependencies", widget: "slider", loosens: "lower", min: 0, max: 30, step: 1, unit: "days", inert: "Needs dependency registry metadata, which PullUp doesn't ingest yet." },

  // Tests
  { path: "guardrails.tests.requireForBehaviorChange", label: "Require a test change for code changes", help: "Production code changed with no test change blocks auto-approval.", group: "tests", widget: "switch", loosens: "false" },
  { path: "guardrails.tests.testOnlyFastPath", label: "Test-only PRs are trivial tier", help: "Lets test-only PRs take the fast path.", group: "tests", widget: "switch", loosens: "true" },

  // Authors
  { path: "guardrails.authors.aiAuthors", label: "AI author logins", help: "PRs from these logins (or labelled ai-generated) are AI-authored.", group: "authors", widget: "chips", loosens: "shrink" },
  { path: "guardrails.authors.aiSizeMultiplier", label: "AI-authored size limit", help: "Size limits are multiplied by this for AI-authored PRs.", group: "authors", widget: "slider", loosens: "higher", min: 0.25, max: 1, step: 0.05, unit: "×" },
  { path: "guardrails.authors.trustedBots", label: "Trusted bots", help: "Exempt from the first-time-contributor rule.", group: "authors", widget: "chips", loosens: "grow" },

  // Freeze
  { path: "guardrails.freezeWindows", label: "Freeze windows", help: "Nothing is auto-approved inside a freeze window.", group: "freeze", widget: "text", loosens: "shrink" },

  // Risk signals
  { path: "jev.thresholds.sensitiveHigh", label: "Escalate at", help: "Escalate when Jev is at least this sure a hunk touches an escalating area (auth, secrets, validation, schema).", group: "signals", widget: "slider", loosens: "higher", min: 0.5, max: 1, step: 0.05 },
  { path: "jev.thresholds.sensitiveMedium", label: "Ask for a reviewer at", help: "Route to a reviewer with rationale when any sensitive signal reaches this.", group: "signals", widget: "slider", loosens: "higher", min: 0.1, max: 0.95, step: 0.05 },
  { path: "jev.thresholds.injection", label: "Injection tripwire at", help: "Escalate when code seems to address reviewers or bots.", group: "signals", widget: "slider", loosens: "higher", min: 0.1, max: 0.95, step: 0.05 },
  { path: "jev.thresholds.fastPathMaxRisk", label: "Fast path: max risk signal", help: "Every risk signal must be below this for the fast path.", group: "signals", widget: "slider", loosens: "higher", min: 0, max: 0.5, step: 0.05 },
  { path: "jev.thresholds.fastPathMinLowRisk", label: "Fast path: min formatting evidence", help: "Formatting-only evidence needed outside the docs/test tiers.", group: "signals", widget: "slider", loosens: "lower", min: 0.5, max: 1, step: 0.05 },
  { path: "jev.thresholds.fastPathMinConfidence", label: "Fast path: min change-kind confidence", help: "Confidence needed that a change is docs/test/formatting.", group: "signals", widget: "slider", loosens: "lower", min: 0.5, max: 1, step: 0.05 },
  { path: "jev.disabledQuestions", label: "Switched-off questions", help: "Built-in risk questions PullUp no longer asks.", group: "signals", widget: "chips", loosens: "grow" },
  { path: "jev.customQuestions", label: "Custom risk questions", help: "Owner-written yes/no questions. Raise-only.", group: "questions", widget: "text", loosens: "neutral" },
  { path: "jev.budgetUsdPerRun", label: "Budget per run", help: "Hard stop on model spend per signal run.", group: "model", widget: "number", loosens: "neutral", min: 0, step: 0.5, unit: "USD" },
  { path: "jev.concurrency", label: "Concurrency", help: "Parallel model calls.", group: "model", widget: "number", loosens: "neutral", min: 1, max: 64, step: 1 },
  { path: "jev.requestsPerMinute", label: "Requests per minute", help: "Rate limit for model calls.", group: "model", widget: "number", loosens: "neutral", min: 1, step: 60 },
  { path: "jev.multiplierMax", label: "Max risk multiplier", help: "Cap on how far calibrated risk can raise P(defect).", group: "model", widget: "number", loosens: "neutral", min: 1, step: 0.5 },

  // Calibration gates (loosening any is a typed-confirm change)
  { path: "jev.gate.minMerged", label: "Min labelled PRs", help: "History needed before calibration can apply.", group: "gates", widget: "number", loosens: "lower", min: 0, step: 10 },
  { path: "jev.gate.minDefects", label: "Min defects", help: "Defects needed in history.", group: "gates", widget: "number", loosens: "lower", min: 0, step: 1 },
  { path: "jev.gate.minAuroc", label: "Min AUROC", help: "Discrimination the risk model must reach.", group: "gates", widget: "number", loosens: "lower", min: 0, max: 1, step: 0.01 },
  { path: "jev.gate.maxEce", label: "Max calibration error", help: "Adaptive ECE the fit must stay under.", group: "gates", widget: "number", loosens: "higher", min: 0, max: 1, step: 0.01 },
  { path: "jev.gate.minFastPathPrecision", label: "Min fast-path precision", help: "The bar for ever un-stubbing approval.", group: "gates", widget: "number", loosens: "lower", min: 0, max: 1, step: 0.01 },

  ...PRIOR_FIELDS.map((f): FieldSpec => ({ ...f, widget: "number", loosens: f.loosens ?? "neutral" })),
];

function matches(pattern: string, path: string): boolean {
  const a = pattern.split(".");
  const b = path.split(".");
  return a.length === b.length && a.every((p, i) => p === "*" || p === b[i]);
}

export function fieldFor(path: string): FieldSpec | null {
  return FIELDS.find((f) => matches(f.path, path)) ?? null;
}

export function fieldsIn(group: FieldGroup): FieldSpec[] {
  return FIELDS.filter((f) => f.group === group);
}

export type ChangeDirection = "loosens" | "tightens" | "neutral";

export interface ConfigChange {
  readonly path: string;
  readonly label: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly direction: ChangeDirection;
}

function num(v: unknown, spec: FieldSpec): number {
  if (v === null || v === undefined) return spec.nullIsUnlimited ? Number.POSITIVE_INFINITY : 0;
  return Number(v);
}

function direction(spec: FieldSpec | null, before: unknown, after: unknown): ChangeDirection {
  if (!spec) return "neutral";
  switch (spec.loosens) {
    case "higher":
    case "lower": {
      const a = num(before, spec);
      const b = num(after, spec);
      if (a === b) return "neutral";
      return (b > a) === (spec.loosens === "higher") ? "loosens" : "tightens";
    }
    case "false":
    case "true":
      return after === (spec.loosens === "true") ? "loosens" : "tightens";
    case "shrink":
    case "grow": {
      const key = (x: unknown) => JSON.stringify(x);
      const A = new Set((Array.isArray(before) ? before : []).map(key));
      const B = new Set((Array.isArray(after) ? after : []).map(key));
      const added = [...B].some((x) => !A.has(x));
      const removed = [...A].some((x) => !B.has(x));
      if (spec.loosens === "grow") return added ? "loosens" : removed ? "tightens" : "neutral";
      return removed ? "loosens" : added ? "tightens" : "neutral";
    }
    case "rank": {
      const order = spec.order ?? [];
      const a = order.indexOf(String(before));
      const b = order.indexOf(String(after));
      return b > a ? "loosens" : b < a ? "tightens" : "neutral";
    }
    default:
      return "neutral";
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Field-level diff between two *effective* configs (defaults merged in), with
 * each change labelled from the registry. Adds a synthetic "approves without
 * blocking" entry when the authority combination newly becomes that.
 */
export function diffConfig(before: ConfigFile, after: ConfigFile): ConfigChange[] {
  const a = flattenConfig(before as Record<string, unknown>);
  const b = flattenConfig(after as Record<string, unknown>);
  const out: ConfigChange[] = [];
  for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (path === "preset") continue;
    if (same(a[path], b[path])) continue;
    const spec = fieldFor(path);
    out.push({ path, label: spec?.label ?? path, before: a[path], after: b[path], direction: direction(spec, a[path], b[path]) });
  }
  // Rules: added/changed rules that loosen, or removed rules that tightened, loosen the gate.
  const rulesChange = out.find((c) => c.path === "rules");
  if (rulesChange) {
    const key = (r: ReviewRule) => JSON.stringify(r);
    const A = (Array.isArray(rulesChange.before) ? rulesChange.before : []) as ReviewRule[];
    const B = (Array.isArray(rulesChange.after) ? rulesChange.after : []) as ReviewRule[];
    const added = B.filter((r) => !A.some((x) => key(x) === key(r)));
    const removed = A.filter((r) => !B.some((x) => key(x) === key(r)));
    const rb = resolveConfigFile(before);
    const ra = resolveConfigFile(after);
    const loosens =
      added.some((r) => ruleLoosens(r, ra.guardrails, ra.severity)) || removed.some((r) => ruleTightens(r, rb.guardrails, rb.severity));
    const tightens = added.some((r) => ruleTightens(r, ra.guardrails, ra.severity));
    const i = out.indexOf(rulesChange);
    out[i] = {
      ...rulesChange,
      before: A.map((r) => `${r.name}: ${describeRule(r)}`),
      after: B.map((r) => `${r.name}: ${describeRule(r)}`),
      direction: loosens ? "loosens" : tightens ? "tightens" : "neutral",
    };
  }
  const authA = (getPath(before, "actions") ?? {}) as ActionAuthority;
  const authB = (getPath(after, "actions") ?? {}) as ActionAuthority;
  if (authB.approve && approvesWithoutBlocking(authB) && !approvesWithoutBlocking(authA)) {
    out.push({
      path: "actions",
      label: "Approves PRs but never blocks one",
      before: null,
      after: `approve ${authB.approve} · request changes ${authB.requestChanges}`,
      direction: "loosens",
    });
  }
  return out;
}

export function loosening(changes: readonly ConfigChange[]): ConfigChange[] {
  return changes.filter((c) => c.direction === "loosens");
}

export function authorityRank(level: AuthorityLevel): number {
  return AUTHORITY_RANK[level];
}
