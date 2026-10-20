// Learnings: repeated decision outcomes turned into suggestions an operator
// may accept. Adapted from Warden's passive memory (deterministic eligibility
// from supporting versus contradicting outcomes across independent runs,
// candidates inactive until a person acts), with one rule on top:
//
//   Nothing is ever applied automatically. A suggestion is a list of config
//   edits the Settings page can open as a draft, where the normal save flow
//   (preview, loosens/tightens, typed confirm for loosening) applies.
//
// No language model is used here: groups, counts, thresholds and the mapping
// from learning kind to config edit are all code. Pure.

import type { ReviewRule } from "../config/rules.js";
import { sha256 } from "../signals/hunks.js";
import type { DecisionOutcome } from "./derive.js";

export const LEARNING_POLICY_VERSION = "pullup-learnings-v1";

/** Thresholds of `pullup-learnings-v1`; changing them bumps the policy version. */
export const LEARNING_THRESHOLDS = {
  overEscalation: { minPulls: 8, minRate: 0.7, baselineMargin: 0.15, contradictionDays: 30 },
  confirmedPattern: { minPulls: 5, minRate: 0.6 },
  missedRisk: { minPulls: 2, days: 30 },
  reviewGuidance: { minPulls: 5, days: 90 },
} as const;

export type LearningKind = "over-escalation" | "confirmed-pattern" | "missed-risk" | "review-guidance";

export type ConfigOp =
  | { readonly op: "set"; readonly path: string; readonly value: unknown }
  | { readonly op: "add-rule"; readonly rule: ReviewRule };

export interface Learning {
  readonly id: string;
  readonly kind: LearningKind;
  /** The finding id (e.g. `signal:touchesAuthz`), when the learning is about one. */
  readonly question: string | null;
  /** A folder glob such as `src/billing/**`. */
  readonly pathFamily: string;
  readonly evidence: {
    readonly pulls: readonly number[];
    readonly support: number;
    readonly contradictions: number;
    readonly total: number;
    readonly rate: number;
    /** The repo-wide rate the support rate is compared with (over-escalation only). */
    readonly baseline: number | null;
  };
  readonly summary: string;
  readonly suggestion: { readonly text: string; readonly ops: readonly ConfigOp[] };
  readonly policyVersion: string;
  readonly status: "suggested" | "dismissed";
}

export interface LearningDismissal {
  readonly repoId: string;
  readonly learningId: string;
  /** Support when dismissed: suggested again only once the evidence doubles. */
  readonly support: number;
  readonly at: string;
  readonly by: string;
}

const SAFE_FAMILY = /^[A-Za-z0-9._\-/*]+$/;

/** `src/billing/retry.ts` → `src/billing/**`; `lib/x.ts` → `lib/**`; `README.md` → `README.md`. */
export function pathFamily(path: string): string {
  const parts = path.split("/");
  if (parts.length >= 3) return `${parts[0]}/${parts[1]}/**`;
  if (parts.length === 2) return `${parts[0]}/**`;
  return path;
}

const DECIDED = (o: DecisionOutcome) => o.outcome !== "pending" && o.outcome !== "closed";
const DAY = 86_400_000;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ruleName = (s: string) => s.replace(/[^A-Za-z0-9 _.,:()'&/+-]/g, "").slice(0, 60).trim();
const qName = (q: string) => q.replace(/^signal:/, "");

/** Latest decided outcome per pull, per key. */
function latestPerPull(outcomes: readonly DecisionOutcome[]): DecisionOutcome[] {
  const by = new Map<number, DecisionOutcome>();
  for (const o of outcomes) {
    const prev = by.get(o.pullNumber);
    if (!prev || o.decidedAt > prev.decidedAt) by.set(o.pullNumber, o);
  }
  return [...by.values()];
}

function group<T>(items: readonly T[], keys: (t: T) => readonly string[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) for (const k of new Set(keys(it))) out.set(k, [...(out.get(k) ?? []), it]);
  return out;
}

/** (finding id, path family) keys of a decision's signal findings. */
const signalKeys = (o: DecisionOutcome) =>
  o.findings.filter((f) => f.id.startsWith("signal:") && f.kind === "signal").flatMap((f) => f.paths.map((p) => `${f.id}\u0000${pathFamily(p)}`));

export function computeLearnings(
  repoId: string,
  outcomes: readonly DecisionOutcome[],
  dismissals: readonly LearningDismissal[],
  now: string,
): Learning[] {
  const T = LEARNING_THRESHOLDS;
  const decided = outcomes.filter(DECIDED);
  const out: Learning[] = [];
  const make = (l: Omit<Learning, "id" | "policyVersion" | "status" | "repoId">): void => {
    if (!SAFE_FAMILY.test(l.pathFamily)) return;
    const id = sha256(LEARNING_POLICY_VERSION, repoId, l.kind, l.question ?? "", l.pathFamily).slice(0, 12);
    const dismissed = dismissals.filter((d) => d.learningId === id).sort((a, b) => b.at.localeCompare(a.at))[0];
    const status = dismissed && l.evidence.support < dismissed.support * 2 ? "dismissed" : "suggested";
    out.push({ ...l, id, policyVersion: LEARNING_POLICY_VERSION, status });
  };

  // Over-escalation: asks humans actually saw, approved unchanged and quickly, well above the repo's baseline.
  const asks = latestPerPull(decided.filter((o) => o.sent && o.action === "defer_to_human"));
  const baseline = asks.length > 0 ? asks.filter((o) => o.outcome === "ask-unneeded").length / asks.length : 0;
  const allAsksSent = decided.filter((o) => o.sent && o.action === "defer_to_human");
  for (const [key, list] of group(allAsksSent, signalKeys)) {
    const [question, family] = key.split("\u0000") as [string, string];
    const perPull = latestPerPull(list);
    const support = perPull.filter((o) => o.outcome === "ask-unneeded").length;
    const contradictions = perPull.filter((o) => o.outcome === "ask-useful").length;
    const recentUseful = list.some((o) => o.outcome === "ask-useful" && Date.parse(now) - Date.parse(o.decidedAt) <= T.overEscalation.contradictionDays * DAY);
    const rate = support / perPull.length;
    if (perPull.length < T.overEscalation.minPulls || rate < T.overEscalation.minRate || rate < baseline + T.overEscalation.baselineMargin || recentUseful) continue;
    make({
      kind: "over-escalation",
      question,
      pathFamily: family,
      evidence: { pulls: perPull.map((o) => o.pullNumber).sort((a, b) => a - b), support, contradictions, total: perPull.length, rate, baseline },
      summary: `PullUp asked for a human on ${perPull.length} pull requests flagged \`${qName(question)}\` in \`${family}\`; ${support} (${pct(rate)}) were approved on the same commit within minutes, against ${pct(baseline)} for all asks.`,
      suggestion: {
        text: `Make \`${qName(question)}\` a P2 finding (a note, not an ask) repo-wide. This loosens the gate, so saving it needs a typed confirmation.`,
        ops: [{ op: "set", path: `severity.questionLevels.${qName(question)}`, value: "p2" }],
      },
    });
  }

  // Confirmed pattern: when this question fires in this folder, humans usually ask for changes.
  const flagged = decided.filter((o) => o.action !== "approve");
  for (const [key, list] of group(flagged, signalKeys)) {
    const [question, family] = key.split("\u0000") as [string, string];
    const perPull = latestPerPull(list);
    const support = perPull.filter((o) => o.outcome === "ask-useful" || o.outcome === "changes-addressed").length;
    const contradictions = perPull.filter((o) => o.outcome === "ask-unneeded" || o.outcome === "changes-overridden").length;
    const rate = support / perPull.length;
    if (perPull.length < T.confirmedPattern.minPulls || rate < T.confirmedPattern.minRate) continue;
    const level = list.flatMap((o) => o.findings).find((f) => f.id === question)?.level;
    make({
      kind: "confirmed-pattern",
      question,
      pathFamily: family,
      evidence: { pulls: perPull.map((o) => o.pullNumber).sort((a, b) => a - b), support, contradictions, total: perPull.length, rate, baseline: null },
      summary: `On ${support} of ${perPull.length} pull requests flagged \`${qName(question)}\` in \`${family}\` (${pct(rate)}), humans asked for changes or new commits followed.`,
      suggestion:
        level === "p1" || level === "p2"
          ? { text: `Raise \`${qName(question)}\` to P0 (blocking).`, ops: [{ op: "set", path: `severity.questionLevels.${qName(question)}`, value: "p0" }] }
          : {
              text: `\`${qName(question)}\` is already P0. Consider letting confirmed findings request changes (Settings → When PullUp finds problems → Verified only).`,
              ops: [],
            },
    });
  }

  // Missed risk: approvals humans overrode, or that a revert/hotfix followed.
  const recentMisses = decided.filter((o) => o.outcome === "human-overrode-approve" && Date.parse(now) - Date.parse(o.decidedAt) <= T.missedRisk.days * DAY);
  for (const [family, list] of group(recentMisses, (o) => o.files.map(pathFamily))) {
    const pulls = [...new Set(list.map((o) => o.pullNumber))].sort((a, b) => a - b);
    if (pulls.length < T.missedRisk.minPulls) continue;
    const name = ruleName(`Learned: no auto-approve in ${family.replace(/\/\*\*$/, "")}`);
    make({
      kind: "missed-risk",
      question: null,
      pathFamily: family,
      evidence: { pulls, support: pulls.length, contradictions: 0, total: pulls.length, rate: 1, baseline: null },
      summary: `In the last ${T.missedRisk.days} days, ${pulls.length} pull requests touching \`${family}\` that PullUp would approve were overridden by a human or followed by a revert or hotfix.`,
      suggestion: { text: `Add a rule: never auto-approve pull requests touching \`${family}\`.`, ops: [{ op: "add-rule", rule: { name, when: { paths: [family] }, set: { noAutoApprove: true } } }] },
    });
  }

  // Review guidance: where humans keep finding something after PullUp asks. Text only, for the owner to edit.
  const useful = decided.filter((o) => o.outcome === "ask-useful" && Date.parse(now) - Date.parse(o.decidedAt) <= T.reviewGuidance.days * DAY);
  const allAsks = decided.filter((o) => o.action === "defer_to_human" && Date.parse(now) - Date.parse(o.decidedAt) <= T.reviewGuidance.days * DAY);
  for (const [family, list] of group(useful, (o) => o.files.map(pathFamily))) {
    const pulls = [...new Set(list.map((o) => o.pullNumber))];
    if (pulls.length < T.reviewGuidance.minPulls) continue;
    const total = new Set(allAsks.filter((o) => o.files.some((f) => pathFamily(f) === family)).map((o) => o.pullNumber)).size;
    const sentence = `Humans requested changes on ${pulls.length} of ${total} pull requests touching ${family} in the last ${T.reviewGuidance.days} days.`;
    make({
      kind: "review-guidance",
      question: null,
      pathFamily: family,
      evidence: { pulls: pulls.sort((a, b) => a - b), support: pulls.length, contradictions: 0, total, rate: total ? pulls.length / total : 0, baseline: null },
      summary: sentence,
      suggestion: { text: `Copy into the review focus if it helps the explanation writer: “${sentence}”`, ops: [] },
    });
  }

  return out.sort((a, b) => a.kind.localeCompare(b.kind) || b.evidence.support - a.evidence.support || a.id.localeCompare(b.id));
}
