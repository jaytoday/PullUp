// The rationale writer's view of repo history: up to three suggested learnings
// whose folder matches the pull request, as numbers and identifiers only,
// fenced as derived data. It can shape the explanation, never the action.

import { matchesAny } from "../policy/policy.js";
import type { Learning } from "./learn.js";

export function repoHistoryBlock(learnings: readonly Learning[], files: readonly string[]): string | null {
  const relevant = learnings
    .filter((l) => l.status === "suggested" && files.some((f) => matchesAny(f, [l.pathFamily])))
    .slice(0, 3)
    .map((l) => ({
      kind: l.kind,
      question: l.question,
      paths: l.pathFamily,
      pulls: l.evidence.total,
      supporting: l.evidence.support,
      rate: Math.round(l.evidence.rate * 100) / 100,
    }));
  if (relevant.length === 0) return null;
  return `<repo_history trust="derived-data">\n${JSON.stringify(relevant).replaceAll("<", "\\u003c")}\n</repo_history>`;
}
