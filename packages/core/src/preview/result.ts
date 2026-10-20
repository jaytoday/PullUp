// What a preview reports: PullUp's decision for a branch that isn't a pull
// request yet, why, what keeps it off the fast path, and fixed hints for each
// blocker (from a table in code, never from a model). Pure.

import type { PlannedReviewAction } from "../actions/review.js";
import { findingAction } from "../actions/review.js";
import type { PullDecision } from "../cost/decision.js";

export const PREVIEW_VERSION = 1;

export interface PreviewBlocker {
  readonly kind: "always-human" | "approval-blocker" | "finding";
  readonly detail: string;
  readonly hint: string;
}

export interface PreviewResult {
  readonly version: typeof PREVIEW_VERSION;
  readonly repoId: string;
  readonly base: string;
  readonly head: string;
  readonly headSha: string;
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
  readonly would: {
    /** What PullUp would do as soon as the pull request opens (null: nothing yet, it waits). */
    readonly action: PlannedReviewAction["action"] | null;
    readonly authority: string | null;
    readonly recommendation: string;
    readonly reason: string;
    /** Hours until shipping becomes cheaper than waiting (w*). */
    readonly maxWaitHours: number;
  };
  readonly fastPath: { readonly eligible: boolean; readonly blockers: readonly PreviewBlocker[] };
  readonly findings: readonly { readonly id: string; readonly level: string; readonly source: string; readonly title: string; readonly paths: readonly string[] }[];
  readonly signals: { readonly model: string | null; readonly band: string | null; readonly questionSet: string | null };
  readonly history: { readonly ingested: boolean; readonly mergedPulls: number };
  readonly notes: readonly string[];
  readonly sent: false;
}

const HINTS: ReadonlyArray<readonly [RegExp, (m: RegExpExecArray) => string]> = [
  [/(\d+) lines > (\d+)-line limit/, (m) => `Split the change into pull requests under ${m[2]} lines (generated, vendored and lockfile paths don't count).`],
  [/(\d+) files > (\d+)-file limit/, (m) => `Touch fewer files: split the change under ${m[2]} files.`],
  [/tier paths are above the approvable tier/, () => "These paths always need a human approval in this repo; expect a human review."],
  [/dependency .* not auto-approvable/, () => "This kind of dependency update needs a human; keep it in its own pull request."],
  [/freeze window/, () => "A freeze window is on: nothing is auto-approved until it ends."],
  [/rule “(.+)”: never auto-approved/, (m) => `The repo's rule “${m[1]}” keeps these files out of auto-approval; expect a human review.`],
];

function hintFor(text: string): string {
  for (const [re, fn] of HINTS) {
    const m = re.exec(text);
    if (m) return fn(m);
  }
  return "Expect a human review for this.";
}

const FINDING_HINT: Readonly<Record<string, string>> = {
  "tests-missing": "Add or update a test next to the changed code.",
  "net-negative": "The change is small next to its review cost; consider folding it into related work.",
  unevaluated: "Some hunks couldn't be evaluated (too large or binary); a human will look at them.",
};

export function previewResult(input: {
  readonly repoId: string;
  readonly base: string;
  readonly head: string;
  readonly headSha: string;
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
  readonly decision: PullDecision;
  readonly planned: PlannedReviewAction | null;
  readonly model: string | null;
  readonly questionSet: string | null;
  readonly mergedPulls: number;
  /** Whether the repo has been ingested at all (it may still have no merged pull requests). */
  readonly ingested: boolean;
  readonly notes: readonly string[];
}): PreviewResult {
  const d = input.decision;
  const blockers: PreviewBlocker[] = [];
  for (const r of d.guardrails?.requireHuman ?? []) blockers.push({ kind: "always-human", detail: r, hint: "This always needs a human in this repo. Don't try to avoid it; expect a human review." });
  for (const b of d.guardrails?.approveBlockers ?? []) blockers.push({ kind: "approval-blocker", detail: b, hint: hintFor(b) });
  for (const f of (d.findings ?? []).filter((x) => x.active)) {
    const act = d.scope ? findingAction(d, f) : "ask-human";
    if (act === "note") continue;
    blockers.push({
      kind: "finding",
      detail: `${f.level.toUpperCase()} ${f.title}`,
      hint: FINDING_HINT[f.kind] ?? "A risk signal flagged this; a human will look. Describe the change clearly; don't reword code to avoid the signal.",
    });
  }
  for (const r of d.risk?.escalateReasons ?? []) if (!blockers.some((b) => b.detail === r)) blockers.push({ kind: "always-human", detail: r, hint: "A strong risk signal or path rule: a human will review it." });
  return {
    version: PREVIEW_VERSION,
    repoId: input.repoId,
    base: input.base,
    head: input.head,
    headSha: input.headSha,
    files: input.files,
    additions: input.additions,
    deletions: input.deletions,
    would: {
      action: input.planned?.action ?? null,
      authority: input.planned?.authority ?? null,
      recommendation: d.recommendation,
      reason: input.planned?.reason ?? d.reason,
      maxWaitHours: d.maxWaitHours,
    },
    fastPath: { eligible: blockers.length === 0 && d.recommendation !== "request-changes", blockers },
    findings: (d.findings ?? []).map((f) => ({
      id: f.id,
      level: f.level,
      source: f.source,
      title: f.title,
      paths: [...new Set((f.units ?? []).map((u) => u.slice(0, u.lastIndexOf("#"))))],
    })),
    signals: { model: input.model, band: d.risk?.band ?? null, questionSet: input.questionSet },
    history: { ingested: input.ingested, mergedPulls: input.mergedPulls },
    notes: input.notes,
    sent: false,
  };
}

const ACTION_WORD: Record<string, string> = { approve: "approve", request_changes: "request changes", defer_to_human: "ask a human" };

/** The human-readable preview. */
export function renderPreview(r: PreviewResult): string {
  const lines: string[] = [];
  lines.push(`PullUp preview · ${r.repoId} · ${r.base}...${r.head} (${r.files} files, +${r.additions} −${r.deletions})`, "");
  lines.push(
    `Would:     ${r.would.action ? `${ACTION_WORD[r.would.action]}${r.would.authority && r.would.authority !== "act" ? ` (${r.would.authority === "comment" ? "as a comment" : "silently"})` : ""}` : "wait for a human review"} — ${r.would.reason}`,
  );
  if (r.fastPath.eligible) lines.push(`Fast path: open — shipping is cheaper than waiting after ~${r.would.maxWaitHours.toFixed(1)} h if no one reviews`);
  else {
    lines.push(`Fast path: blocked by ${r.fastPath.blockers.length} thing${r.fastPath.blockers.length === 1 ? "" : "s"}`);
    for (const b of r.fastPath.blockers) lines.push(`           - ${b.detail}`, `             → ${b.hint}`);
  }
  lines.push(`Max wait:  ${r.would.maxWaitHours.toFixed(1)} h (w*)`);
  lines.push("", `Signals:   ${r.signals.model ?? "off"}${r.signals.band ? ` · band ${r.signals.band}` : ""}${r.signals.questionSet ? ` · ${r.signals.questionSet}` : ""}`);
  if (!r.history.ingested) lines.push("History:   none ingested — wait times use default priors. Run `pullup fetch <repo>` first.");
  else if (r.history.mergedPulls === 0) lines.push("History:   no merged pull requests yet — wait times use default priors.");
  else lines.push(`History:   ${r.history.mergedPulls} merged pull requests`);
  for (const n of r.notes) lines.push(`Note:      ${n}`);
  lines.push("A preview, not a promise: the real pull request's author, labels and timing can differ. Nothing was sent to GitHub.");
  return lines.join("\n");
}
