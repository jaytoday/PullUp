import type { ParsedCiRun } from "./ci";
import type { ConcernCase } from "./concerns";

/**
 * The input PullUp sends its `pullup/ci-review` runtime for one concern. It
 * matches `askwithai/runtime.yaml`'s input schema. `concern` and
 * `blastRadius` are kept on AskWithAI's records for routing even when inputs
 * are not retained.
 */
export interface AssessInput extends Record<string, unknown> {
  concern: ConcernCase["concern"];
  repository: string;
  headSha: string;
  title: string;
  body: string;
  evidence: Array<{ source: "diff" | "log"; where: string; text: string }>;
  blastRadius: number;
  diffTruncated: boolean;
}

const MAX_BODY = 2000;
/** Above this many diff characters, PullUp sends only the evidence and says the diff was cut. */
export const MAX_DIFF_CHARS = 200_000;

export function assessInput(c: ConcernCase, run: ParsedCiRun): AssessInput {
  return {
    concern: c.concern,
    repository: run.repo,
    headSha: run.headSha,
    title: run.pull?.title ?? "",
    body: (run.pull?.body ?? "").slice(0, MAX_BODY),
    evidence: c.evidence.map((e) => ({ source: e.source, where: e.line === null ? e.where : `${e.where}:${e.line}`, text: e.text })),
    blastRadius: c.blastRadius,
    diffTruncated: run.diff.length > MAX_DIFF_CHARS,
  };
}
