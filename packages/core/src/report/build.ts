// Assembles the full typed PullUp report: analytics + cost params + decisions.

import { attachVerdicts } from "../verify/run.js";
import type { AnalyticsReport } from "../analytics/types.js";
import type { CostPriors } from "../config/config.js";
import { decideForRepo, summarizeDecisions } from "../cost/decision.js";
import type { PullDecision } from "../cost/decision.js";
import { assembleParams } from "../cost/params.js";
import type { CostParams } from "../cost/params.js";
import type { PullStore } from "../schema/store.js";
import { runAnalytics } from "../analytics/run.js";
import type { JevRuntime, RiskSummary } from "../signals/runtime.js";
import { assessOpenPulls } from "../signals/runtime.js";
import type { GuardrailsConfig, Tier } from "../config/guardrails.js";
import type { PolicyRules } from "../policy/policy.js";
import type { ReviewRule } from "../config/rules.js";
import type { SeverityConfig } from "../config/severity.js";
import { DEFAULT_SEVERITY } from "../config/severity.js";
import { DEFAULT_JEV_CONFIG } from "../signals/config.js";
import { evaluateRepoGuardrails } from "../policy/guardrails.js";

export interface PullupReport {
  readonly repoId: string;
  readonly generatedAt: string;
  readonly configPath: string | null;
  readonly pulls: { total: number; merged: number; reviewed: number };
  readonly analytics: AnalyticsReport;
  readonly params: CostParams;
  readonly decisions: readonly PullDecision[];
  readonly summary: {
    readonly meanMaxWaitHours: number | null;
    readonly p50MaxWaitHours: number | null;
    readonly congestionQueueDepth: number | null;
    readonly counts: ReturnType<typeof summarizeDecisions>;
  };
  /** Jev risk layer summary — present only when the layer is shadow/active. */
  readonly risk?: RiskSummary;
  /** Guardrail summary over open PRs — present only when guardrails were evaluated. */
  readonly guardrails?: GuardrailSummary;
  /** Which config produced this report — present when the caller supplies it. */
  readonly configProvenance?: ConfigProvenance;
}

export interface GuardrailSummary {
  readonly escalated: number;
  readonly approvalBlocked: number;
  readonly tiers: Readonly<Record<Tier, number>>;
  readonly limits: { readonly lines: number | null; readonly files: number | null; readonly approveMaxTier: string };
  /** Active findings over open PRs, by level. */
  readonly findings: Readonly<Record<"p0" | "p1" | "p2", number>>;
  /** Open PRs each scoped rule applied to. */
  readonly rules: Readonly<Record<string, number>>;
}

export interface ConfigProvenance {
  /** Repo config version (null = file/defaults only). */
  readonly version: number | null;
  readonly hash: string;
}

export interface BuildReportOptions {
  readonly now?: string;
  readonly configPath?: string | null;
  /** Jev risk layer. Absent or mode "off" ⇒ the report is unchanged. */
  readonly jev?: JevRuntime;
  /** Guardrails + the effective policy they read. Absent ⇒ the report is unchanged. */
  readonly guardrails?: {
    readonly config: GuardrailsConfig;
    readonly policy: PolicyRules;
    readonly rules?: readonly ReviewRule[];
    readonly severity?: SeverityConfig;
  };
  readonly configProvenance?: ConfigProvenance;
  /** Attach cached evidence-verifier verdicts to signal findings. Absent ⇒ the report is unchanged. */
  readonly verify?: boolean;
}

export async function buildReport(
  store: PullStore,
  repoId: string,
  priors: CostPriors,
  opts: BuildReportOptions = {},
): Promise<PullupReport> {
  const now = opts.now ?? new Date().toISOString();
  const analytics = await runAnalytics(store, repoId, priors);
  const params = assembleParams(analytics, priors);
  const jevOn = opts.jev !== undefined && opts.jev.config.mode !== "off";
  const risk = jevOn ? await assessOpenPulls(store, repoId, params, opts.jev!) : null;
  const g = opts.guardrails;
  const guards = g
    ? await evaluateRepoGuardrails(store, repoId, g.policy, g.config, now, { rules: g.rules, severity: g.severity })
    : undefined;
  const ctx = g
    ? {
        severity: g.severity ?? DEFAULT_SEVERITY,
        sensitiveHigh: (opts.jev?.config ?? DEFAULT_JEV_CONFIG).thresholds.sensitiveHigh,
      }
    : undefined;
  const decided = await decideForRepo(store, repoId, params, now, risk?.overlays, guards, ctx);
  const decisions = opts.verify ? await attachVerdicts(store, repoId, decided) : decided;

  const maxWaits = decisions.map((d) => d.maxWaitHours);
  const sorted = [...maxWaits].sort((a, b) => a - b);
  const meanMaxWaitHours =
    sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
  const p50MaxWaitHours = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] ?? null : null;

  return {
    repoId,
    generatedAt: now,
    configPath: opts.configPath ?? null,
    pulls: {
      total: analytics.pullCount,
      merged: analytics.mergedCount,
      reviewed: analytics.reviewedCount,
    },
    analytics,
    params,
    decisions,
    summary: {
      meanMaxWaitHours,
      p50MaxWaitHours,
      congestionQueueDepth: analytics.congestion.current?.queueDepth ?? null,
      counts: summarizeDecisions(decisions),
    },
    ...(risk ? { risk: risk.summary } : {}),
    ...(opts.guardrails && guards ? { guardrails: summarizeGuardrails(decisions, opts.guardrails.config) } : {}),
    ...(opts.configProvenance ? { configProvenance: opts.configProvenance } : {}),
  };
}

function summarizeGuardrails(decisions: readonly PullDecision[], cfg: GuardrailsConfig): GuardrailSummary {
  const tiers: Record<Tier, number> = { trivial: 0, low: 0, standard: 0, high: 0, critical: 0 };
  let escalated = 0;
  let approvalBlocked = 0;
  const findings = { p0: 0, p1: 0, p2: 0 };
  const rules: Record<string, number> = {};
  for (const d of decisions) {
    if (!d.guardrails) continue;
    if (d.state === "open") {
      for (const f of d.findings ?? []) if (f.active) findings[f.level] += 1;
      for (const r of d.scope?.appliedRules ?? []) rules[r.name] = (rules[r.name] ?? 0) + 1;
    }
    tiers[d.guardrails.tier] += 1;
    if (d.guardrails.requireHuman.length > 0) escalated += 1;
    else if (d.guardrails.approveBlockers.length > 0) approvalBlocked += 1;
  }
  return {
    escalated,
    approvalBlocked,
    tiers,
    limits: { lines: cfg.maxAutoApproveLines, files: cfg.maxAutoApproveFiles, approveMaxTier: cfg.approveMaxTier },
    findings,
    rules,
  };
}
