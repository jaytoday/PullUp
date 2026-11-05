import type { Question } from "@pullup/sdk";
import { type Config, parseConfig } from "./config";
import type { RunDecision } from "./resolution";

/**
 * Runs stored before extensions keep the old shapes: a parsed config with
 * top-level `triggers`, `sensitivePaths` and `ask.perTrigger`, and questions
 * with `trigger` and a bare id (`flaky-test`). These read either shape and
 * return today's. (The `asks` table's question ids are rewritten by the
 * database migration `0006`.)
 */

export function storedConfig(raw: unknown): Config {
  const old = raw as Record<string, unknown>;
  // A config parsed before extensions always had `triggers` (default {}); one parsed since never has it.
  return "triggers" in old ? parseConfig(old) : (raw as Config);
}

export function storedQuestion(raw: Question | (Omit<Question, "extension" | "key" | "shadow"> & { trigger: string })): Question {
  if ("extension" in raw) return raw;
  const { trigger, ...rest } = raw;
  return { ...rest, id: `core:${trigger}`, extension: "core", key: trigger, shadow: false };
}

export function storedDecision(raw: unknown): RunDecision {
  const d = raw as RunDecision;
  return { ...d, extensions: d.extensions ?? null, questions: d.questions.map((q) => ({ ...q, question: storedQuestion(q.question) })) };
}
