import type { RunDecision } from "./resolution";

/**
 * What the "PullUp" check run on GitHub shows for a decision. In shadow mode
 * the conclusion is always neutral (it never blocks a merge) and the would-be
 * result is in the title and summary. Active mode (phase 4) maps the result to
 * success or failure; a run waiting for a person stays in progress.
 */

export type CheckMode = "shadow" | "active";

export interface CheckRunView {
  status: "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | null;
  title: string;
  summary: string;
}

const WORD = { pass: "pass", fail: "fail", waiting: "ask a person" } as const;

export function checkRunView(decision: RunDecision, mode: CheckMode, notes: string[] = []): CheckRunView {
  const lines: string[] = [];
  if (mode === "shadow") lines.push("**Shadow mode**: PullUp records what it would decide and never blocks a merge.", "");
  lines.push(decision.reason, "");
  for (const f of decision.hardFailures) lines.push(`- Hard failure: ${f.reason}`);
  for (const q of decision.questions) {
    lines.push(`### ${q.question.summary}`, `${q.question.prompt}`, "", `**${q.outcome === "ask" ? "Ask a person" : q.outcome === "pass" ? "Pass" : "Fail"}**: ${q.reason}`, "");
    for (const s of q.seats) {
      lines.push(`- ${s.seat.split(":")[0]}: ${s.verdict} (strength ${s.strength})${s.reason ? `. ${s.reason}` : ""}`);
      for (const quote of s.validQuotes) lines.push(`  > \`${quote.text.replace(/`/g, "'")}\` (${quote.source})`);
    }
    lines.push("");
  }
  if (decision.councilCalls) lines.push(`Council: ${decision.councilCalls} calls.`);
  for (const n of notes) lines.push(`_Note: ${n}_`);
  const summary = lines.join("\n").slice(0, 60_000);
  if (mode === "shadow") {
    return { status: "completed", conclusion: "neutral", title: `Shadow: would ${WORD[decision.result]}`, summary };
  }
  if (decision.result === "waiting") return { status: "in_progress", conclusion: null, title: "Waiting for a person", summary };
  return { status: "completed", conclusion: decision.result === "pass" ? "success" : "failure", title: decision.result === "pass" ? "Passed" : "Failed", summary };
}
