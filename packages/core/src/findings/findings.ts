// Findings: every reason PullUp might act on a PR, with a severity (P0/P1/P2)
// and a source. `rule` findings are deterministic and reproducible; `signal`
// findings come from Jev or custom questions and are probabilistic.
//
// Levels come only from code and typed outputs (config level map + thresholds),
// never from free text. The severity policy then maps each finding to an
// action (see actions/review.ts).

import type { SeverityConfig, SeverityLevel } from "../config/severity.js";
import type { SignalHit } from "../signals/aggregate.js";
import type { FindingVerdict } from "../verify/types.js";

export type FindingSource = "rule" | "signal";

export type FindingKind = "signal" | "custom" | "injection" | "unevaluated" | "tests-missing" | "net-negative";

export interface Finding {
  readonly id: string;
  readonly level: SeverityLevel;
  readonly source: FindingSource;
  readonly kind: FindingKind;
  readonly title: string;
  readonly detail: string;
  /** Signal findings only count toward actions when signals are "Use in decisions". */
  readonly active: boolean;
  /** Signal findings: the unit keys (`path#hunkIndex[.part]`) behind it, for locating it in the diff. */
  readonly units?: readonly string[];
  /** The evidence verifier's checked verdict, when one is cached for these hunks (verify/). */
  readonly verdict?: FindingVerdict;
}

export interface RuleFindingInput {
  readonly kind: Extract<FindingKind, "tests-missing" | "net-negative">;
  readonly detail: string;
}

const LEVEL_ORDER: readonly SeverityLevel[] = ["p0", "p1", "p2"];

/** Default level for a question: escalating → P0, sensitive → P1, custom → P1. */
export function defaultQuestionLevel(kind: SignalHit["kind"]): SeverityLevel {
  return kind === "escalating" || kind === "injection" ? "p0" : "p1";
}

export function questionLevel(hit: Pick<SignalHit, "question" | "kind">, sev: SeverityConfig): SeverityLevel {
  if (hit.kind === "injection") return "p0";
  if (hit.kind === "unevaluated") return "p1";
  const configured = sev.questionLevels[hit.question] ?? defaultQuestionLevel(hit.kind);
  // Owner-written questions are raise-only: capped at P1.
  return hit.kind === "custom" && configured === "p0" ? "p1" : configured;
}

const RULE_TITLE: Record<RuleFindingInput["kind"], string> = {
  "tests-missing": "Behaviour change without tests",
  "net-negative": "Change costs more than it's worth",
};

function humanize(id: string): string {
  const s = id.replace(/^custom:/, "").replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export interface CollectInput {
  readonly hits: readonly SignalHit[] | null;
  /** Whether signals drive decisions ("active"); otherwise signal findings are informational. */
  readonly signalsActive: boolean;
  readonly sensitiveHigh: number;
  readonly severity: SeverityConfig;
  readonly rules: readonly RuleFindingInput[];
}

export function collectFindings(input: CollectInput): Finding[] {
  const out: Finding[] = [];
  for (const r of input.rules) {
    out.push({
      id: `rule:${r.kind}`,
      level: "p1",
      source: "rule",
      kind: r.kind,
      title: RULE_TITLE[r.kind],
      detail: r.detail,
      active: true,
    });
  }
  for (const h of input.hits ?? []) {
    let level = questionLevel(h, input.severity);
    // Lower confidence lowers certainty: a P0 question below the high threshold is a P1.
    if (h.kind === "escalating" && level === "p0" && h.p < input.sensitiveHigh) level = "p1";
    const units = h.units.slice(0, 3).join(", ") + (h.units.length > 3 ? ` +${h.units.length - 3}` : "");
    out.push({
      id: `signal:${h.question}`,
      level,
      source: "signal",
      kind: h.kind === "escalating" || h.kind === "sensitive" ? "signal" : h.kind,
      title:
        h.kind === "unevaluated"
          ? `${h.units.length} unit(s) not evaluated — unknown risk`
          : h.kind === "injection"
            ? "Text addressed to reviewers or bots (injection tripwire)"
            : humanize(h.question),
      detail: h.kind === "unevaluated" ? units : `p=${h.p.toFixed(2)} · ${units}`,
      active: input.signalsActive,
      units: [...h.units],
    });
  }
  return out.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.id.localeCompare(b.id));
}

export function countByLevel(findings: readonly Finding[]): Record<SeverityLevel, number> {
  const c: Record<SeverityLevel, number> = { p0: 0, p1: 0, p2: 0 };
  for (const f of findings) c[f.level] += 1;
  return c;
}
