// What happened after each PullUp decision, derived only from stored data
// (logged/sent review actions, ingested reviews, pull states, defect events
// and PullUp's own inline comments). Deterministic: same store, same `now`,
// same outcomes. Recomputed on every read; nothing here writes.
//
//   approve (would approve / approved)
//     human-agreed-approve    a human approved, or it merged, and no revert/hotfix within the window
//     human-overrode-approve  a human requested changes, or a revert/hotfix followed within the window
//   ask a human
//     ask-unneeded            a human approved the same commit within quickApproveMinutes
//     ask-useful              the human requested changes, or new commits came before the approval
//     ask-approved            approved the same commit, but not quickly (counted neither way)
//   request changes
//     changes-addressed       new commits followed (or PullUp resolved its finding) and it merged
//     changes-overridden      merged on the same commit PullUp blocked
//   closed                    closed without merging
//   pending                   not enough has happened yet

import type { BotReviewAction, ReviewActionRecord } from "../actions/review.js";
import type { OutcomesConfig } from "../config/outcomes.js";
import type { SeverityLevel } from "../config/severity.js";
import { parseUnitKey } from "../findings/locations.js";
import type { PullRecord, ReviewRecord } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";

export type DecisionOutcomeKind =
  | "human-agreed-approve"
  | "human-overrode-approve"
  | "ask-unneeded"
  | "ask-useful"
  | "ask-approved"
  | "changes-addressed"
  | "changes-overridden"
  | "closed"
  | "pending";

export interface OutcomeFinding {
  readonly id: string;
  readonly level: SeverityLevel;
  readonly kind: string;
  readonly paths: readonly string[];
  readonly verdict: string | null;
}

export interface DecisionOutcome {
  readonly repoId: string;
  readonly pullNumber: number;
  readonly headSha: string;
  readonly action: BotReviewAction;
  readonly decidedAt: string;
  /** Whether humans could see it: sent to GitHub (comment or act), not only logged. */
  readonly sent: boolean;
  readonly authority: string | null;
  readonly configVersion: number | null;
  readonly author: string;
  readonly files: readonly string[];
  readonly findings: readonly OutcomeFinding[];
  readonly outcome: DecisionOutcomeKind;
  readonly detail: string;
  /** True when "same commit" was judged from the pull's current head (the review didn't record its commit). */
  readonly approximate: boolean;
}

const HOUR = 3_600_000;

/** PullUp's own and other bots' reviews never count as a human response. */
const isHuman = (r: ReviewRecord) => !/\[bot\]$/i.test(r.author);

function findingPaths(units: readonly string[] | undefined): string[] {
  return [...new Set((units ?? []).map((u) => parseUnitKey(u)?.path).filter((p): p is string => !!p))];
}

export function deriveOutcome(
  rec: ReviewActionRecord,
  pull: PullRecord,
  reviews: readonly ReviewRecord[],
  defects: readonly { readonly at: string }[],
  resolvedByPullUp: boolean,
  cfg: OutcomesConfig,
  now: string,
): Pick<DecisionOutcome, "outcome" | "detail" | "approximate"> {
  const after = reviews
    .filter((r) => isHuman(r) && r.submittedAt >= rec.loggedAt && r.state !== "COMMENTED")
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const sameCommit = (r: ReviewRecord) => (r.commitId ? r.commitId === rec.headSha : pull.headSha === rec.headSha);
  const approximate = after.some((r) => !r.commitId);
  const minutes = (r: ReviewRecord) => (Date.parse(r.submittedAt) - Date.parse(rec.loggedAt)) / 60_000;
  const mergedAt = pull.mergedAt;
  const windowOver = mergedAt ? Date.parse(now) - Date.parse(mergedAt) >= cfg.defectWindowDays * 24 * HOUR : false;
  const defectAfterMerge = mergedAt
    ? defects.find((d) => d.at >= mergedAt && Date.parse(d.at) - Date.parse(mergedAt) <= cfg.defectWindowDays * 24 * HOUR)
    : undefined;

  if (rec.action === "approve") {
    const blocked = after.find((r) => r.state === "CHANGES_REQUESTED");
    if (blocked) return { outcome: "human-overrode-approve", detail: `${blocked.author} requested changes`, approximate };
    if (defectAfterMerge) return { outcome: "human-overrode-approve", detail: `revert/hotfix ${defectAfterMerge.at.slice(0, 10)} after merge`, approximate };
    if (mergedAt && windowOver) return { outcome: "human-agreed-approve", detail: `merged, no revert/hotfix within ${cfg.defectWindowDays} days`, approximate };
    if (pull.state === "closed") return { outcome: "closed", detail: "closed without merging", approximate };
    return { outcome: "pending", detail: mergedAt ? "merged; waiting out the defect window" : "not merged yet", approximate };
  }

  if (rec.action === "defer_to_human") {
    const first = after[0];
    if (first?.state === "CHANGES_REQUESTED") return { outcome: "ask-useful", detail: `${first.author} requested changes`, approximate };
    if (first?.state === "APPROVED") {
      if (!sameCommit(first)) return { outcome: "ask-useful", detail: "new commits before the approval", approximate };
      return minutes(first) <= cfg.quickApproveMinutes
        ? { outcome: "ask-unneeded", detail: `${first.author} approved the same commit in ${Math.max(0, Math.round(minutes(first)))} min`, approximate }
        : { outcome: "ask-approved", detail: `${first.author} approved the same commit after ${Math.round(minutes(first))} min`, approximate };
    }
    if (pull.state === "closed") return { outcome: "closed", detail: "closed without merging", approximate };
    if (mergedAt) return { outcome: "ask-approved", detail: "merged without a recorded human review", approximate };
    return { outcome: "pending", detail: "no human review yet", approximate };
  }

  // request_changes
  if (mergedAt) {
    const moved = pull.headSha !== rec.headSha;
    return moved || resolvedByPullUp
      ? { outcome: "changes-addressed", detail: resolvedByPullUp ? "PullUp resolved its finding, then it merged" : "new commits, then it merged", approximate: false }
      : { outcome: "changes-overridden", detail: "merged on the commit PullUp blocked", approximate: false };
  }
  if (pull.state === "closed") return { outcome: "closed", detail: "closed without merging", approximate: false };
  return { outcome: "pending", detail: "still open", approximate: false };
}

/** Every recorded decision's outcome for one repo (denied actions excluded: nothing was decided to send). */
export async function deriveOutcomes(store: PullStore, repoId: string, cfg: OutcomesConfig, now: string): Promise<DecisionOutcome[]> {
  const [actions, pulls, reviews, defects, comments] = await Promise.all([
    store.listReviewActions(repoId),
    store.listPulls(repoId),
    store.listReviews(repoId),
    store.listDefectEvents(repoId),
    store.listFindingComments(repoId),
  ]);
  const pullBy = new Map(pulls.map((p) => [p.number, p]));
  const out: DecisionOutcome[] = [];
  for (const rec of actions) {
    if (rec.status === "denied") continue;
    const pull = pullBy.get(rec.pullNumber);
    if (!pull) continue;
    const resolved = comments.some((c) => c.pullNumber === rec.pullNumber && c.status === "resolved-by-pullup");
    const o = deriveOutcome(
      rec,
      pull,
      reviews.filter((r) => r.pullNumber === rec.pullNumber),
      defects.filter((d) => d.pullNumber === rec.pullNumber),
      resolved,
      cfg,
      now,
    );
    out.push({
      repoId,
      pullNumber: rec.pullNumber,
      headSha: rec.headSha,
      action: rec.action,
      decidedAt: rec.loggedAt,
      sent: rec.status === "sent",
      authority: rec.authority ?? null,
      configVersion: rec.configVersion ?? null,
      author: pull.author,
      files: pull.files,
      findings: (rec.findings ?? []).map((f) => ({ id: f.id, level: f.level, kind: f.kind, paths: findingPaths(f.units), verdict: f.verdict?.verdict ?? null })),
      ...o,
    });
  }
  return out.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt) || a.pullNumber - b.pullNumber);
}

export interface OutcomeSummary {
  readonly total: number;
  readonly byOutcome: Readonly<Record<DecisionOutcomeKind, number>>;
  /** Sent asks only: the share approved unchanged and quickly. */
  readonly askUnneededRate: number | null;
  readonly approvalsOverridden: number;
  readonly changesAddressed: number;
  /** Per config version (null = file/defaults): decided outcomes by kind. */
  readonly byConfigVersion: readonly { readonly version: number | null; readonly counts: Readonly<Partial<Record<DecisionOutcomeKind, number>>> }[];
  /** Per finding id: decided outcomes by kind (signal and rule findings). */
  readonly byFinding: readonly { readonly findingId: string; readonly counts: Readonly<Partial<Record<DecisionOutcomeKind, number>>>; readonly pulls: number }[];
}

const KINDS: readonly DecisionOutcomeKind[] = [
  "human-agreed-approve",
  "human-overrode-approve",
  "ask-unneeded",
  "ask-useful",
  "ask-approved",
  "changes-addressed",
  "changes-overridden",
  "closed",
  "pending",
];

export function summarizeOutcomes(outcomes: readonly DecisionOutcome[]): OutcomeSummary {
  const byOutcome = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<DecisionOutcomeKind, number>;
  for (const o of outcomes) byOutcome[o.outcome] += 1;
  const sentAsks = outcomes.filter((o) => o.sent && o.action === "defer_to_human" && o.outcome !== "pending" && o.outcome !== "closed");
  const versions = new Map<number | null, Partial<Record<DecisionOutcomeKind, number>>>();
  const findings = new Map<string, { counts: Partial<Record<DecisionOutcomeKind, number>>; pulls: Set<number> }>();
  for (const o of outcomes) {
    if (o.outcome === "pending") continue;
    const v = versions.get(o.configVersion) ?? {};
    v[o.outcome] = (v[o.outcome] ?? 0) + 1;
    versions.set(o.configVersion, v);
    for (const f of o.findings) {
      const e = findings.get(f.id) ?? { counts: {}, pulls: new Set<number>() };
      e.counts[o.outcome] = (e.counts[o.outcome] ?? 0) + 1;
      e.pulls.add(o.pullNumber);
      findings.set(f.id, e);
    }
  }
  return {
    total: outcomes.length,
    byOutcome,
    askUnneededRate: sentAsks.length > 0 ? sentAsks.filter((o) => o.outcome === "ask-unneeded").length / sentAsks.length : null,
    approvalsOverridden: byOutcome["human-overrode-approve"],
    changesAddressed: byOutcome["changes-addressed"],
    byConfigVersion: [...versions.entries()].sort((a, b) => (a[0] ?? -1) - (b[0] ?? -1)).map(([version, counts]) => ({ version, counts })),
    byFinding: [...findings.entries()].sort((a, b) => b[1].pulls.size - a[1].pulls.size || a[0].localeCompare(b[0])).map(([findingId, e]) => ({ findingId, counts: e.counts, pulls: e.pulls.size })),
  };
}
