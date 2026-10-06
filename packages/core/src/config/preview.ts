// What-if preview: how a draft config would change PullUp's behaviour on this
// repo's own data, before it's saved. Reads cached signals only (never calls a
// model) and writes nothing.
//
//   open PRs  — the full plan (decision → action → authority) under each config
//   history   — recent merged PRs: would each have been inside the approval
//               envelope (guardrails pass, no raised signal)? For PRs that
//               newly qualify, did they later ship a defect proxy?

import { planReviewActions } from "../actions/review.js";
import type { PlannedReviewAction } from "../actions/review.js";
import { evaluateGuardrails } from "../policy/guardrails.js";
import { evaluatePolicy } from "../policy/policy.js";
import { buildReport } from "../report/build.js";
import { median } from "../schema/domain.js";
import type { PullRecord } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";
import { assessPull } from "../signals/aggregate.js";
import { loadPullSignals } from "../signals/run.js";
import type { JevRuntime } from "../signals/runtime.js";
import { resolveWeights } from "../signals/runtime.js";
import { defectProbability } from "../cost/model.js";
import type { CostParams } from "../cost/params.js";
import type { ResolvedConfig } from "./schema.js";

export interface PreviewSide {
  readonly config: ResolvedConfig;
  /** Jev runtime (cached signals only), or null when the layer is off. */
  readonly jev: JevRuntime | null;
}

export interface ActionCounts {
  readonly approve: number;
  readonly requestChanges: number;
  readonly requestHuman: number;
  readonly none: number;
  /** Actions that would really be sent at `act` (vs commented / suppressed). */
  readonly acting: number;
}

export interface FlippedPull {
  readonly pullNumber: number;
  readonly title: string;
  readonly before: string;
  readonly after: string;
}

export interface HistoryPull {
  readonly pullNumber: number;
  readonly title: string;
  readonly lines: number;
  readonly defectProxy: string | null;
}

export interface ConfigPreview {
  readonly open: {
    readonly total: number;
    readonly before: ActionCounts;
    readonly after: ActionCounts;
    readonly flipped: readonly FlippedPull[];
  };
  readonly history: {
    readonly total: number;
    readonly eligibleBefore: number;
    readonly eligibleAfter: number;
    readonly newlyEligible: readonly HistoryPull[];
    readonly newlyBlocked: readonly HistoryPull[];
    /** Defect-proxy rate among newly eligible PRs, and across all history in the window. */
    readonly newlyEligibleDefectRate: number | null;
    readonly baselineDefectRate: number | null;
    readonly unevaluated: number;
  };
  readonly maxWait: { readonly medianBefore: number | null; readonly medianAfter: number | null };
  /** How many open / recent merged PRs each draft rule matches (so a glob that matches nothing shows up). */
  readonly rules: ReadonlyArray<{ readonly name: string; readonly open: number; readonly history: number }>;
  readonly notes: readonly string[];
}

export interface PreviewOptions {
  readonly now: string;
  /** How many recent merged PRs to replay (default 300). */
  readonly historyLimit?: number;
}

function describe(a: PlannedReviewAction | undefined): string {
  if (!a) return "no action";
  const verb = a.action === "approve" ? "approve" : a.action === "request_changes" ? "request changes" : "ask a human";
  return `${verb} (${a.authority ?? "act"})`;
}

function count(actions: readonly PlannedReviewAction[], openTotal: number): ActionCounts {
  const n = (k: PlannedReviewAction["action"]) => actions.filter((a) => a.action === k).length;
  return {
    approve: n("approve"),
    requestChanges: n("request_changes"),
    requestHuman: n("defer_to_human"),
    none: openTotal - actions.length,
    acting: actions.filter((a) => a.authority === "act").length,
  };
}

async function planOpen(store: PullStore, repoId: string, side: PreviewSide, now: string) {
  const cfg = side.config;
  const report = await buildReport(store, repoId, cfg.priors, {
    now,
    jev: side.jev ?? undefined,
    guardrails: { config: cfg.guardrails, policy: cfg.policy, rules: cfg.rules, severity: cfg.severity },
  });
  const planned = planReviewActions(report.decisions, await store.listPulls(repoId), {
    repoId,
    humanReviewers: cfg.jev.humanReviewers,
    authority: cfg.authority,
    configVersion: cfg.version,
  });
  return { report, planned };
}

async function eligibleHistory(
  store: PullStore,
  repoId: string,
  pulls: readonly PullRecord[],
  side: PreviewSide,
  params: CostParams,
  mergedAt: ReadonlyMap<string, readonly string[]>,
): Promise<{ eligible: Set<number>; unevaluated: number; lines: Map<number, number>; ruleHits: Map<string, number> }> {
  const cfg = side.config;
  const rt = side.jev && side.jev.config.mode === "active" ? side.jev : null;
  const weights = rt ? resolveWeights(rt, repoId) : null;
  const eligible = new Set<number>();
  const lines = new Map<number, number>();
  const ruleHits = new Map<string, number>();
  let unevaluated = 0;
  for (const pull of pulls) {
    const hunks = await store.listHunks(repoId, pull.number);
    const authorHasMergedBefore = (mergedAt.get(pull.author) ?? []).some((m) => m < pull.createdAt);
    const g = evaluateGuardrails({
      pull,
      hunks,
      policy: cfg.policy,
      config: cfg.guardrails,
      authorHasMergedBefore,
      now: pull.createdAt,
      rules: cfg.rules,
      severity: cfg.severity,
    });
    lines.set(pull.number, g.lines);
    for (const r of g.appliedRules) ruleHits.set(r.name, (ruleHits.get(r.name) ?? 0) + 1);
    // Rule-backed findings are P1: unless P1 is "note only" for this PR, they keep it out of the envelope.
    const blockingRuleFinding = g.ruleFindings.length > 0 && g.scope.actions.p1 !== "note";
    let ok = g.requireHuman.length === 0 && g.approveBlockers.length === 0 && !blockingRuleFinding;
    if (ok && rt && weights) {
      const signals = await loadPullSignals(store, pull, rt.qs, rt.modelId);
      if (signals.answers.some((a) => a === null)) unevaluated += 1;
      const a = assessPull({
        pull,
        policy: evaluatePolicy(pull.files, cfg.policy),
        signals,
        qs: rt.qs,
        config: rt.config,
        weights: weights.weights,
        calibrated: weights.calibrated,
        baseDefectProbability: defectProbability(params, pull.changeType),
      });
      ok = a.band === "standard" || a.band === "fast-path";
    }
    if (ok) eligible.add(pull.number);
  }
  return { eligible, unevaluated, lines, ruleHits };
}

export async function previewConfig(
  store: PullStore,
  repoId: string,
  current: PreviewSide,
  draft: PreviewSide,
  opts: PreviewOptions,
): Promise<ConfigPreview> {
  const notes: string[] = [];
  const [a, b] = [await planOpen(store, repoId, current, opts.now), await planOpen(store, repoId, draft, opts.now)];
  const openPulls = a.report.decisions.filter((d) => d.state === "open");
  const beforeBy = new Map(a.planned.map((x) => [x.pullNumber, x]));
  const afterBy = new Map(b.planned.map((x) => [x.pullNumber, x]));
  const flipped: FlippedPull[] = [];
  for (const d of openPulls) {
    const x = describe(beforeBy.get(d.pullNumber));
    const y = describe(afterBy.get(d.pullNumber));
    if (x !== y) flipped.push({ pullNumber: d.pullNumber, title: d.title, before: x, after: y });
  }

  const all = await store.listPulls(repoId);
  const mergedAt = new Map<string, string[]>();
  for (const p of all) {
    if (!p.mergedAt) continue;
    const list = mergedAt.get(p.author);
    if (list) list.push(p.mergedAt);
    else mergedAt.set(p.author, [p.mergedAt]);
  }
  const history = all
    .filter((p) => p.state === "merged" && p.mergedAt)
    .sort((x, y) => y.mergedAt!.localeCompare(x.mergedAt!))
    .slice(0, opts.historyLimit ?? 300);
  const hb = await eligibleHistory(store, repoId, history, current, a.report.params, mergedAt);
  const ha = await eligibleHistory(store, repoId, history, draft, b.report.params, mergedAt);
  const toRow = (p: PullRecord): HistoryPull => ({
    pullNumber: p.number,
    title: p.title,
    lines: ha.lines.get(p.number) ?? p.additions + p.deletions,
    defectProxy: p.defectProxy,
  });
  const newlyEligible = history.filter((p) => ha.eligible.has(p.number) && !hb.eligible.has(p.number)).map(toRow);
  const newlyBlocked = history.filter((p) => hb.eligible.has(p.number) && !ha.eligible.has(p.number)).map(toRow);
  const rate = (rows: readonly { defectProxy: string | null }[]) =>
    rows.length === 0 ? null : rows.filter((r) => r.defectProxy !== null).length / rows.length;
  const unevaluated = Math.max(hb.unevaluated, ha.unevaluated);
  if (unevaluated > 0) {
    notes.push(`${unevaluated} merged PR(s) have no cached risk signals and count as not eligible — run signals on all PRs for a fuller preview.`);
  }
  if (history.length === 0) notes.push("No merged history yet — only open PRs are compared.");

  return {
    open: {
      total: openPulls.length,
      before: count(a.planned, openPulls.length),
      after: count(b.planned, openPulls.length),
      flipped,
    },
    history: {
      total: history.length,
      eligibleBefore: hb.eligible.size,
      eligibleAfter: ha.eligible.size,
      newlyEligible,
      newlyBlocked,
      newlyEligibleDefectRate: rate(newlyEligible),
      baselineDefectRate: rate(history),
      unevaluated,
    },
    rules: draft.config.rules.map((r) => ({
      name: r.name,
      open: b.report.guardrails?.rules[r.name] ?? 0,
      history: ha.ruleHits.get(r.name) ?? 0,
    })),
    maxWait: {
      medianBefore: median(openPulls.map((d) => d.maxWaitHours)),
      medianAfter: median(b.report.decisions.filter((d) => d.state === "open").map((d) => d.maxWaitHours)),
    },
    notes,
  };
}
