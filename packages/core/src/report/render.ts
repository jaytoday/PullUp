// Markdown (progressive disclosure) + JSON rendering of the PullUp report.

import { findOptimalWait } from "../cost/model.js";
import type { PullupReport } from "./build.js";

function fmt(x: number | null, digits = 1): string {
  if (x === null) return "—";
  return x.toFixed(digits);
}

function pct(x: number | null): string {
  if (x === null) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

export function renderMarkdown(report: PullupReport): string {
  const { analytics, params, summary, decisions } = report;
  const latency = analytics.latency.timeToFirstReviewHours;
  const outcomes = analytics.outcomes;
  const defects = analytics.defects;
  const congestion = analytics.congestion;
  const open = decisions.filter((d) => d.state === "open");
  const counts = summary.counts;

  const wByType = Object.fromEntries(
    [...new Set(decisions.map((d) => d.changeType))]
      .concat(["feature", "bugfix", "refactor", "dependency", "docs", "other"])
      .sort()
      .map((t) => [t, maxWaitForType(params, t)]),
  );

  const lines: string[] = [];

  lines.push(`# PullUp — ${report.repoId}`);
  lines.push("");
  lines.push(`Generated ${report.generatedAt}. ` +
    `${report.pulls.total} PRs · ${report.pulls.merged} merged · ${report.pulls.reviewed} reviewed.` +
    `${report.configPath ? ` Config: ${report.configPath}.` : ""}`);
  lines.push("");

  lines.push("## Executive summary");
  lines.push("");
  const congestionLevel = summary.congestionQueueDepth === null
    ? "no data"
    : summary.congestionQueueDepth >= 2
      ? "congested"
      : summary.congestionQueueDepth >= 1
        ? "busy"
        : "healthy";
  lines.push(`- **Review load:** queue depth κ = ${fmt(summary.congestionQueueDepth)} (${congestionLevel}).`);
  lines.push(`- **Time to first human review:** p50 ${fmt(latency.p50)}h · p90 ${fmt(latency.p90)}h (n=${latency.n}).`);
  lines.push(`- **Shipping risk:** ${pct(defects.overall.rate)} of merged PRs (${defects.overall.defects}/${defects.overall.n}) shipped a defect proxy; review removes e_max = ${fmt(params.eMax * 100, 1)}% of ship-risk.`);
  lines.push(`- **Max-wait by change type:** ${Object.entries(wByType)
    .map(([t, w]) => `${t} ${w}h`)
    .join(" · ")}.`);
  lines.push(`- **Today's recommendation:** ${counts.autoApprove} auto-approve-eligible · ${counts.keepReviewing} keep-reviewing · ${counts.requestChanges} request-changes (over ${open.length} open PRs).`);
  lines.push("");

  lines.push("## Two-cost comparison");
  lines.push("");
  lines.push("Costs in dev-hours. Waiting `D(w)` vs shipping-before-review `E(w)`; w* is where the marginal curves cross.");
  lines.push("");
  lines.push(`- **Waiting cost rate** r_v = ${fmt(params.valueDelayRatePerHour, 3)} h/h (congestion-inflated by κ = ${fmt(params.congestionQueueDepth, 2)}).`);
  lines.push(`- **Expected defect cost** C_defect = ${params.defectReworkHours}h rework × ${params.escalationMultiplier}x escalation = ${fmt(params.defectReworkHours * params.escalationMultiplier)}h.`);
  lines.push(`- **Review efficacy** e_max = ${fmt(params.eMax * 100, 1)}%, saturating over T_review = ${params.reviewWindowHours}h.`);
  lines.push(`- **P(defect) by type:** ${Object.entries(params.baseDefectProbability)
    .map(([t, p]) => `${t} ${pct(p)}`)
    .join(" · ")}.`);
  lines.push(`- **Marginal curves:** D'(w) = ${fmt(params.valueDelayRatePerHour + params.conflictRatePerHour * params.conflictResolutionHours, 3)} h/h; review pays while −E'(w) > D'(w).`);
  lines.push("");

  lines.push("## Review latency");
  lines.push("");
  lines.push("| dimension | n | p50 (h) | p90 (h) |");
  lines.push("|---|---|---|---|");
  lines.push(`| time-to-first-review | ${latency.n} | ${fmt(latency.p50)} | ${fmt(latency.p90)} |`);
  lines.push(`| total review time | ${analytics.latency.totalReviewHours.n} | ${fmt(analytics.latency.totalReviewHours.p50)} | ${fmt(analytics.latency.totalReviewHours.p90)} |`);
  lines.push(`| wait (open→merge/close) | ${analytics.latency.waitHours.n} | ${fmt(analytics.latency.waitHours.p50)} | ${fmt(analytics.latency.waitHours.p90)} |`);
  for (const [area, s] of Object.entries(analytics.latency.byArea)) {
    lines.push(`| area: ${area} | ${s.n} | ${fmt(s.p50)} | ${fmt(s.p90)} |`);
  }
  lines.push("");

  lines.push("## Approval / rejection vs wait time");
  lines.push("");
  lines.push(`Pearson(wait, approval) = ${fmt(outcomes.approvalVsWaitCorrelation, 3)} · Pearson(wait, request-changes) = ${fmt(outcomes.changesRequestedVsWaitCorrelation, 3)}.`);
  lines.push("");
  lines.push("| wait bucket (h) | n | approvals | changes | approval rate | changes rate | shipped-defect rate |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const b of outcomes.buckets) {
    lines.push(`| ≥${b.bucketHours} | ${b.n} | ${b.approvals} | ${b.changesRequested} | ${pct(b.approvalRate)} | ${pct(b.changesRequestedRate)} | ${pct(b.shippedDefectRate)} |`);
  }
  lines.push("");

  lines.push("## Defect proxies (revert / hotfix / follow-up fix / reopen)");
  lines.push("");
  lines.push(`Overall: ${pct(defects.overall.rate)} (${defects.overall.defects}/${defects.overall.n} merged).`);
  lines.push("");
  lines.push("| change type | n | defects | rate |");
  lines.push("|---|---|---|---|");
  for (const [t, r] of Object.entries(defects.byChangeType)) {
    lines.push(`| ${t} | ${r.n} | ${r.defects} | ${pct(r.rate)} |`);
  }
  lines.push("");

  lines.push("## Congestion (daily queue)");
  lines.push("");
  lines.push(`Mean queue depth ${fmt(congestion.meanQueueDepth, 2)} · latest day ${congestion.current ? congestion.current.day : "—"}: ${congestion.current ? `${fmt(congestion.current.queueDepth, 2)} (${congestion.current.openPullsAwaitingReview} awaiting · ${congestion.current.activeReviewers} active reviewers)` : "no data"}.`);
  lines.push("");

  lines.push("## Open-PR decisions");
  lines.push("");
  lines.push("| PR | type | area | wait (h) | w* (h) | rec | reason |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const d of open) {
    lines.push(`| #${d.pullNumber} ${d.title.slice(0, 40)} | ${d.changeType} | ${d.area} | ${d.waitHours} | ${d.maxWaitHours} | ${d.recommendation} | ${d.reason} |`);
  }
  lines.push("");

  lines.push("## Parameter provenance");
  lines.push("");
  lines.push("| parameter | value | source |");
  lines.push("|---|---|---|");
  const provRows: Array<[string, string, string]> = [
    ["valueDelayRatePerHour (r_v)", `${fmt(params.valueDelayRatePerHour, 3)} h/h`, params.provenance.valueDelayRatePerHour?.source ?? "prior"],
    ["baseDefectProbability", `${pct(defects.overall.rate)} measured → shrunk per type`, params.provenance.baseDefectProbability?.source ?? "prior"],
    ["review efficacy e_max", `${fmt(params.eMax * 100, 1)}%`, params.provenance.eMax?.source ?? "prior"],
    ["congestionQueueDepth κ", fmt(params.congestionQueueDepth, 2), params.provenance.congestionQueueDepth?.source ?? "prior"],
    ["defectReworkHours", `${fmt(params.defectReworkHours)}h`, params.provenance.defectReworkHours?.source ?? "prior"],
    ["escalationMultiplier", `${params.escalationMultiplier}x`, params.provenance.escalationMultiplier?.source ?? "prior"],
  ];
  for (const [k, v, src] of provRows) {
    lines.push(`| ${k} | ${v} | ${src} |`);
  }
  lines.push("");

  return lines.join("\n");
}

/** w* for a change type given the report's params (model recompute). */
function maxWaitForType(params: PullupReport["params"], type: string): number {
  return findOptimalWait(params, type as Parameters<typeof findOptimalWait>[1]);
}

/** JSON rendering of the report. */
export function renderJson(report: PullupReport): string {
  return JSON.stringify(report, null, 2);
}
