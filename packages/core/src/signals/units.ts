// Builds SignalUnits from stored hunks: code-only state, token-budgeted
// chunking, and content-addressed cache keys.

import type { HunkRecord } from "../schema/domain.js";
import { sha256 } from "./hunks.js";
import type { QuestionSet, SignalState, SignalUnit } from "./types.js";

/** Jev: state + the single longest question must fit ~32k tokens. Stay under. */
export const DEFAULT_UNIT_TOKEN_BUDGET = 24_000;

/** Conservative token estimate (~4 chars/token for code). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function longestQuestionTokens(qs: QuestionSet): number {
  let max = 0;
  for (const q of Object.values(qs.questions)) {
    const extra =
      q.kind === "choice"
        ? Object.entries(q.options).map(([k, v]) => k + v).join(" ")
        : q.kind === "score"
          ? q.levels.join(" ")
          : "";
    max = Math.max(max, estimateTokens(q.text + extra));
  }
  return max;
}

/** Stable JSON of the state (fixed key order) — the thing we hash and send. */
export function statePayload(state: SignalState): string {
  return JSON.stringify({ path: state.path, area: state.area, hunk: state.hunk });
}

/** Content-addressed cache key: model ∥ question-set version ∥ state. */
export function cacheKeyFor(modelId: string, qsVersion: string, unit: Pick<SignalUnit, "stateHash">): string {
  return sha256(modelId, qsVersion, unit.stateHash);
}

export interface BuildUnitsOptions {
  readonly area: string;
  readonly tokenBudget?: number;
}

export function buildUnits(
  hunks: readonly HunkRecord[],
  qs: QuestionSet,
  opts: BuildUnitsOptions,
): SignalUnit[] {
  const budget = (opts.tokenBudget ?? DEFAULT_UNIT_TOKEN_BUDGET) - longestQuestionTokens(qs);
  const sorted = [...hunks].sort((a, b) =>
    a.path === b.path ? a.index - b.index : a.path.localeCompare(b.path),
  );
  const units: SignalUnit[] = [];
  for (const h of sorted) {
    const make = (hunkText: string, part: number, flags: { noPatch: boolean; oversize: boolean }): SignalUnit => {
      const state: SignalState = { path: h.path, area: opts.area, hunk: hunkText };
      return {
        key: part === 0 ? `${h.path}#${h.index}` : `${h.path}#${h.index}.${part}`,
        pullNumber: h.pullNumber,
        path: h.path,
        hunkIndex: h.index,
        part,
        state,
        stateHash: sha256(statePayload(state)),
        ...flags,
      };
    };
    if (h.noPatch) {
      units.push(make("", 0, { noPatch: true, oversize: false }));
      continue;
    }
    const full = h.header ? `${h.header}\n${h.patch}` : h.patch;
    // Path + area + JSON framing overhead.
    const overhead = estimateTokens(h.path + opts.area) + 16;
    if (estimateTokens(full) + overhead <= budget) {
      units.push(make(full, 0, { noPatch: false, oversize: false }));
      continue;
    }
    // Split on line boundaries; every part repeats the hunk header for context.
    let part = 0;
    let buf: string[] = h.header ? [h.header] : [];
    let bufTokens = estimateTokens(h.header);
    for (const line of h.patch.split("\n")) {
      const t = estimateTokens(line + "\n");
      if (t + overhead + estimateTokens(h.header) > budget) {
        if (buf.length > (h.header ? 1 : 0)) {
          units.push(make(buf.join("\n"), part++, { noPatch: false, oversize: false }));
        }
        units.push(make("", part++, { noPatch: false, oversize: true }));
        buf = h.header ? [h.header] : [];
        bufTokens = estimateTokens(h.header);
        continue;
      }
      if (bufTokens + t + overhead > budget) {
        units.push(make(buf.join("\n"), part++, { noPatch: false, oversize: false }));
        buf = h.header ? [h.header] : [];
        bufTokens = estimateTokens(h.header);
      }
      buf.push(line);
      bufTokens += t;
    }
    if (buf.length > (h.header ? 1 : 0)) {
      units.push(make(buf.join("\n"), part++, { noPatch: false, oversize: false }));
    }
  }
  return units;
}

/** Units the model can actually be asked about. */
export function evaluable(u: SignalUnit): boolean {
  return !u.noPatch && !u.oversize;
}
