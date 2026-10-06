// Presets set how strict the gate is — not how much authority PullUp has (the
// mode is chosen separately, so "Balanced + Evaluation" is the usual start).
// Picking a preset writes these values into the repo layer; nothing is applied
// implicitly. Numbers are inferred starting points (see the CI taxonomy
// caveats), to be replaced by calibrated percentiles once history exists.
// Browser-safe.

import type { ConfigFile, PresetId } from "./schema.js";

export interface PresetSpec {
  readonly id: PresetId;
  readonly label: string;
  /** Ship/Show/Ask analogue. */
  readonly style: string;
  readonly blurb: string;
  readonly values: ConfigFile;
}

export const PRESETS: readonly PresetSpec[] = [
  {
    id: "conservative",
    label: "Conservative",
    style: "Ask",
    blurb: "Only trivial, small changes can be bot-approved; everything else waits for a human.",
    values: {
      guardrails: {
        maxAutoApproveLines: 100,
        maxAutoApproveFiles: 5,
        approveMaxTier: "trivial",
        dependencies: { autoApprove: [], minReleaseAgeDays: 14 },
        tests: { requireForBehaviorChange: true },
        authors: { aiSizeMultiplier: 0.5 },
      },
      jev: { thresholds: { sensitiveMedium: 0.35, sensitiveHigh: 0.7 } },
      severity: { actions: { p1: "request-changes" } },
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    style: "Show",
    blurb: "Small, low-risk changes can be bot-approved with owners notified; risky paths need a human.",
    values: {
      guardrails: {
        maxAutoApproveLines: 300,
        maxAutoApproveFiles: 15,
        approveMaxTier: "low",
        dependencies: { autoApprove: ["patch:dev"], minReleaseAgeDays: 14 },
        tests: { requireForBehaviorChange: false },
        authors: { aiSizeMultiplier: 0.75 },
      },
      jev: { thresholds: { sensitiveMedium: 0.5, sensitiveHigh: 0.85 } },
      severity: { actions: { p1: "ask-human" } },
    },
  },
  {
    id: "fast-lane",
    label: "Fast lane",
    style: "Ship",
    blurb: "Most ordinary changes can be bot-approved once review stops paying; only raised signals wait.",
    values: {
      guardrails: {
        maxAutoApproveLines: 600,
        maxAutoApproveFiles: 30,
        approveMaxTier: "standard",
        dependencies: { autoApprove: ["patch:dev", "minor:dev", "patch:runtime"], minReleaseAgeDays: 7 },
        tests: { requireForBehaviorChange: false },
        authors: { aiSizeMultiplier: 1 },
      },
      jev: { thresholds: { sensitiveMedium: 0.6, sensitiveHigh: 0.9 } },
      severity: { actions: { p1: "note" } },
    },
  },
];

export function presetSpec(id: PresetId): PresetSpec {
  return PRESETS.find((p) => p.id === id)!;
}
