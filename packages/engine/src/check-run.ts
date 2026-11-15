import { CONCERN_LABEL } from "./config";
import type { Assessment, CheckMode, RunDecision } from "./policy";

/**
 * What the "PullUp" check run on GitHub shows. In Report only mode the
 * conclusion is always neutral (it never blocks a merge) and the would-be
 * result is in the title. In Enforce mode a pass is success, a fail is
 * failure, and a run waiting for a person stays in progress with Pass and
 * Fail buttons.
 */

export interface CheckRunView {
  status: "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | null;
  title: string;
  summary: string;
}

const WORD = { pass: "pass", fail: "fail", waiting: "wait for a person" } as const;

function concernLines(a: Assessment, outcome: string, reason: string): string[] {
  const p = a.probability === null ? "" : ` (p(risky) = ${a.probability.toFixed(2)})`;
  const lines = [`#### ${CONCERN_LABEL[a.concern]}: ${outcome}`, `${a.answer ?? "no answer"}${a.final ? "" : " (provisional)"}${p}, answered by ${a.answeredBy ?? a.provider}${a.synthetic ? " · simulated" : ""}. ${reason}`];
  for (const q of a.verified.slice(0, 3)) lines.push(`> \`${q.quote.replace(/`/g, "'").slice(0, 200)}\``);
  if (a.decisionId) lines.push(`Decision \`${a.decisionId}\``);
  lines.push("");
  return lines;
}

export function checkRunView(decision: RunDecision, assessments: Assessment[], mode: CheckMode, notes: string[] = []): CheckRunView {
  const lines: string[] = [];
  if (mode === "report_only") lines.push("**Report only**: PullUp records what it would decide and never blocks a merge.", "");
  lines.push(decision.reason, "");
  for (const f of decision.hardFailures) lines.push(`- Hard failure: ${f.reason}`);
  for (const c of decision.concerns) {
    const a = assessments.find((x) => x.concern === c.concern);
    if (a) lines.push(...concernLines(a, c.outcome, c.reason));
  }
  for (const n of notes) lines.push(`_Note: ${n}_`);
  const summary = lines.join("\n").slice(0, 60_000);
  if (mode === "report_only") return { status: "completed", conclusion: "neutral", title: `Report only: would ${WORD[decision.result]}`, summary };
  if (decision.result === "waiting") return { status: "in_progress", conclusion: null, title: "Waiting for a person", summary };
  return { status: "completed", conclusion: decision.result === "pass" ? "success" : "failure", title: decision.result === "pass" ? "Passed" : "Failed", summary };
}
