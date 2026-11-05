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
  /** Extensions' file and line findings; a Shadow extension's are notices marked "(Shadow)". */
  annotations: { path: string; line: number; level: "notice" | "warning" | "failure"; message: string }[];
}

const WORD = { pass: "pass", fail: "fail", waiting: "ask a person" } as const;

function questionLines(q: RunDecision["questions"][number]): string[] {
  const lines = [`#### ${q.question.summary}`, `${q.question.prompt} \`${q.question.id}\``, ""];
  if (q.question.relaxedBy) lines.push(`_Relaxed by ${q.question.relaxedBy.extension}: ${q.question.relaxedBy.why}_`, "");
  lines.push(q.outcome === "ask" ? `**${q.reason}**` : `**${q.outcome === "pass" ? "Pass" : "Fail"}**: ${q.reason}`, "");
  for (const s of q.seats) {
    lines.push(`- ${s.seat.split(":")[0]}: ${s.verdict} (strength ${s.strength})${s.reason ? `. ${s.reason}` : ""}`);
    for (const quote of s.validQuotes) lines.push(`  > \`${quote.text.replace(/`/g, "'")}\` (${quote.source})`);
  }
  lines.push("");
  return lines;
}

export function checkRunView(decision: RunDecision, mode: CheckMode, notes: string[] = []): CheckRunView {
  const lines: string[] = [];
  if (mode === "shadow") lines.push("**Shadow mode**: PullUp records what it would decide and never blocks a merge.", "");
  lines.push(decision.reason, "");
  for (const f of decision.hardFailures) lines.push(`- Hard failure: ${f.reason}`);
  const counted = decision.questions.filter((q) => !q.question.shadow);
  const shadow = decision.questions.filter((q) => q.question.shadow);
  // One small heading per extension that raised something.
  for (const extension of [...new Set(counted.map((q) => q.question.extension))]) {
    lines.push(`### ${extension}`, "");
    for (const q of counted.filter((x) => x.question.extension === extension)) lines.push(...questionLines(q));
  }
  if (shadow.length) {
    lines.push("### Would ask (Shadow extensions, not counted)", "");
    for (const q of shadow) lines.push(`- \`${q.question.id}\`: ${q.question.summary} (council: ${q.outcome === "ask" ? "would ask a person" : q.outcome})`);
    lines.push("");
  }
  if (decision.councilCalls) lines.push(`Council: ${decision.councilCalls} calls.`);
  for (const n of decision.extensions?.notes ?? []) lines.push(`- ${n.link ? `[${n.text}](${n.link})` : n.text} _(${n.extension})_`);
  for (const n of notes) lines.push(`_Note: ${n}_`);
  const summary = lines.join("\n").slice(0, 60_000);
  const shadowExtensions = new Set((decision.extensions?.outputs ?? []).filter((o) => o.mode === "shadow").map((o) => o.id));
  const annotations = (decision.extensions?.annotations ?? []).slice(0, 50).map((a) => {
    const quiet = mode === "shadow" || shadowExtensions.has(a.extension);
    return { path: a.path, line: a.line, level: quiet ? ("notice" as const) : a.level, message: `${quiet ? "(Shadow) " : ""}${a.message} [${a.extension}]` };
  });
  if (mode === "shadow") {
    return { status: "completed", conclusion: "neutral", title: `Shadow: would ${WORD[decision.result]}`, summary, annotations };
  }
  if (decision.result === "waiting") return { status: "in_progress", conclusion: null, title: "Waiting for a person", summary, annotations };
  return { status: "completed", conclusion: decision.result === "pass" ? "success" : "failure", title: decision.result === "pass" ? "Passed" : "Failed", summary, annotations };
}
