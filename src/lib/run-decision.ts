import type { RunDecision } from "@pullup/engine";
import { storedDecision } from "@pullup/engine/stored";

/** Read a run's decision with support for older stored question shapes. */
export const decisionOf = (run: { decision: unknown }): RunDecision | null =>
  run.decision ? storedDecision(run.decision) : null;
