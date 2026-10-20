// The GitHub Check run: one "PullUp" check per pull request head, carrying the
// decision, the findings and line annotations. Planned here with the review
// action and sent by the same actuator under the same permit.
//
// The check reports; it is never a way around the review rules:
//
//   approve          act (gate passed) → success · otherwise → neutral
//   request changes  act and blockOn = request-changes → failure · otherwise → neutral
//   ask a human      → neutral (once a human reviews, PullUp stops acting, so a
//                      failing check would be left behind)
//   off              → no check
//
// GitHub treats neutral as passing for a required check, so Evaluation (comment
// level) can never block or unblock a merge through the check.

import type { AuthorityLevel } from "./authority.js";
import type { CheckBlockOn, ChecksConfig } from "../config/checks.js";
import type { Finding } from "../findings/findings.js";
import { locateFinding } from "../findings/locations.js";
import type { HunkRecord } from "../schema/domain.js";

/** GitHub accepts at most 50 annotations per check-run request. */
export const CHECK_ANNOTATION_LIMIT = 50;

export type CheckConclusion = "success" | "neutral" | "failure";

export interface CheckAnnotation {
  readonly path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly annotation_level: "failure" | "warning" | "notice";
  readonly title: string;
  readonly message: string;
}

/** The exact checks.create / checks.update payload. */
export interface CheckRunCall {
  readonly owner: string;
  readonly repo: string;
  readonly name: string;
  readonly head_sha: string;
  readonly status: "completed";
  readonly conclusion: CheckConclusion;
  readonly output: {
    readonly title: string;
    readonly summary: string;
    readonly text: string;
    readonly annotations: readonly CheckAnnotation[];
  };
}

/** What the planner fixes up front; the call is rebuilt from it whenever the level or body changes. */
export interface CheckSpec {
  readonly name: string;
  readonly blockOn: CheckBlockOn;
  /** One line of decision facts (recommendation, band, wait, config). */
  readonly facts: string;
  readonly annotations: readonly CheckAnnotation[];
  /** Located findings beyond the annotation limit. */
  readonly moreAnnotations: number;
}

type CheckAction = "approve" | "request_changes" | "defer_to_human";

export function checkConclusion(action: CheckAction, level: AuthorityLevel, blockOn: CheckBlockOn): CheckConclusion | null {
  if (level === "off") return null;
  if (level !== "act") return "neutral";
  if (action === "approve") return "success";
  if (action === "request_changes" && blockOn === "request-changes") return "failure";
  return "neutral";
}

const LEVEL_ANNOTATION: Record<Finding["level"], CheckAnnotation["annotation_level"]> = {
  p0: "failure",
  p1: "warning",
  p2: "notice",
};

/** One annotation per located hunk of each finding, most severe first, capped at the GitHub limit. */
export function checkAnnotations(
  findings: readonly Finding[],
  hunks: readonly HunkRecord[],
): { annotations: CheckAnnotation[]; more: number } {
  const all: Array<CheckAnnotation & { rank: number }> = [];
  const rank = { p0: 0, p1: 1, p2: 2 } as const;
  for (const f of findings) {
    for (const loc of locateFinding(f, hunks)) {
      all.push({
        rank: rank[f.level],
        path: loc.path,
        start_line: loc.startLine,
        end_line: loc.endLine,
        annotation_level: LEVEL_ANNOTATION[f.level],
        title: `${f.level.toUpperCase()} ${f.title}`.slice(0, 255),
        message: `${f.detail} (${f.source === "rule" ? "rule" : "risk signal"}; PullUp ${f.id})${
          f.verdict?.accepted && f.verdict.verdict === "confirmed"
            ? `\nConfirmed against the code: ${f.verdict.evidence.map((e) => `${e.path}:${e.line} ${e.quote}`).join("; ")}${f.verdict.fix ? `\nSuggested fix: ${f.verdict.fix}` : ""}`
            : ""
        }`,
      });
    }
  }
  all.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path) || a.start_line - b.start_line);
  const annotations = all.slice(0, CHECK_ANNOTATION_LIMIT).map(({ rank: _r, ...a }) => a);
  return { annotations, more: Math.max(0, all.length - CHECK_ANNOTATION_LIMIT) };
}

export function buildCheckSpec(input: {
  readonly checks: ChecksConfig;
  readonly findings: readonly Finding[];
  readonly hunks: readonly HunkRecord[];
  readonly recommendation: string;
  readonly band: string | null;
  readonly waitHours: number;
  readonly maxWaitHours: number;
  readonly configVersion: number | null;
}): CheckSpec {
  const { annotations, more } = input.checks.annotations
    ? checkAnnotations(input.findings, input.hunks)
    : { annotations: [], more: 0 };
  const facts = [
    `Recommendation: ${input.recommendation}`,
    ...(input.band ? [`band: ${input.band}`] : []),
    `waited ${input.waitHours.toFixed(1)} h of a ${input.maxWaitHours.toFixed(1)} h max wait`,
    `config ${input.configVersion === null ? "file/defaults" : `v${input.configVersion}`}`,
  ].join(" · ");
  return { name: input.checks.name, blockOn: input.checks.blockOn, facts, annotations, moreAnnotations: more };
}

const TITLE: Record<CheckAction, { act: string; would: string }> = {
  approve: { act: "Approved by PullUp", would: "PullUp would approve" },
  request_changes: { act: "PullUp requested changes", would: "PullUp would request changes" },
  defer_to_human: { act: "PullUp asked for a human review", would: "PullUp would ask for a human review" },
};

/**
 * The check call for one action at one authority level (null at `off`).
 * `body` is the human-readable decision text (reason or rationale + findings).
 */
export function checkRunCall(
  a: { readonly repoId: string; readonly headSha: string; readonly action: CheckAction; readonly clamped?: string | null },
  spec: CheckSpec,
  level: AuthorityLevel,
  body: string,
): CheckRunCall | null {
  const conclusion = checkConclusion(a.action, level, spec.blockOn);
  if (!conclusion) return null;
  const [owner, repo] = a.repoId.split("/") as [string, string];
  const t = TITLE[a.action];
  const title = level === "act" ? t.act : `${t.would}${a.clamped ? " (approval locked)" : ""}`;
  const mode =
    level === "act"
      ? conclusion === "failure"
        ? "This check fails because PullUp requested changes."
        : "This check reports PullUp's action; it does not block."
      : "Evaluation only: PullUp sent nothing else, and this check never blocks.";
  const more = spec.moreAnnotations > 0 ? `\n\n+${spec.moreAnnotations} more located findings are not annotated (GitHub's limit is ${CHECK_ANNOTATION_LIMIT}).` : "";
  return {
    owner,
    repo,
    name: spec.name,
    head_sha: a.headSha,
    status: "completed",
    conclusion,
    output: {
      title,
      summary: `${spec.facts}\n\n${mode}${a.clamped ? `\n\n${a.clamped}` : ""}${more}`,
      text: body,
      annotations: spec.annotations,
    },
  };
}
