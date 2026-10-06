// The effective question set for a Jev config: the pinned base set, minus any
// disabled sensitive questions, plus the owner's custom questions. Either
// change gets its own version suffix, so the answer cache and any calibration
// artifact stop matching automatically. Browser-safe (FNV hash, no node:crypto).

import { customQuestionId, customQuestionText } from "../../config/screen.js";
import type { JevConfig } from "../config.js";
import type { QuestionSet } from "../types.js";
import { QUESTION_SET_V1 } from "./v1.js";

export const QUESTION_SETS: Readonly<Record<string, QuestionSet>> = {
  [QUESTION_SET_V1.version]: QUESTION_SET_V1,
};

/** 32-bit FNV-1a, hex — stable across runtimes; for version suffixes only. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Built-in questions that may be switched off: sensitive ones, never the tripwire. */
export function disableableQuestions(qs: QuestionSet): readonly string[] {
  return qs.sensitive;
}

export function resolveQuestionSet(cfg: Pick<JevConfig, "questionSet" | "customQuestions" | "disabledQuestions">): QuestionSet {
  const base = QUESTION_SETS[cfg.questionSet];
  if (!base) throw new Error(`Unknown question set "${cfg.questionSet}".`);
  const disabled = [...new Set(cfg.disabledQuestions)].filter((q) => base.sensitive.includes(q)).sort();
  const custom = cfg.customQuestions.map((q) => ({ id: customQuestionId(q.text), text: customQuestionText(q.text) }));
  if (disabled.length === 0 && custom.length === 0) return base;

  const questions = { ...base.questions };
  for (const q of disabled) delete questions[q];
  const customIds: string[] = [];
  for (const c of custom) {
    if (questions[c.id]) continue;
    questions[c.id] = { kind: "noul", text: c.text };
    customIds.push(c.id);
  }
  let version = base.version;
  if (disabled.length > 0) version += `-d${fnv1a(disabled.join("|"))}`;
  if (customIds.length > 0) version += `+c${fnv1a(custom.map((c) => c.text).sort().join("|"))}`;
  return {
    ...base,
    version,
    questions,
    sensitive: base.sensitive.filter((q) => !disabled.includes(q)),
    escalating: base.escalating.filter((q) => !disabled.includes(q)),
    custom: customIds,
  };
}
