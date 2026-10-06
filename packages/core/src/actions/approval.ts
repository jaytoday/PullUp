// When may PullUp *really* approve? Only when both hold:
//
//   1. delivery is live — an operator turned on sending to GitHub
//      (PULLUP_GITHUB_DELIVERY=live); a logged approval approves nothing;
//   2. this repo's calibration artifact passed its fast-path gate — the bar for
//      trusting the bot's "low risk" call (signals/calibrate.ts).
//
// Anything else keeps Approve · Act clamped to a comment. Request changes and
// ask-a-human need only live delivery: they add friction, never remove it.

import type { CalibrationArtifact } from "../signals/calibrate.js";

export type DeliveryMode = "log" | "live";

/** The operator-level delivery switch. Anything but "live" logs only. */
export function resolveDelivery(env: Readonly<Record<string, string | undefined>> = process.env): DeliveryMode {
  return env.PULLUP_GITHUB_DELIVERY?.trim().toLowerCase() === "live" ? "live" : "log";
}

export interface ApprovalGate {
  readonly unlocked: boolean;
  /** Why it is locked (null when unlocked). */
  readonly reason: string | null;
}

export function approvalGate(input: {
  readonly repoId: string;
  readonly delivery: DeliveryMode;
  readonly calibration: CalibrationArtifact | null;
}): ApprovalGate {
  const { repoId, delivery, calibration } = input;
  const missing: string[] = [];
  if (delivery !== "live") missing.push("live GitHub delivery is off");
  if (!calibration) missing.push("this repo has no calibration artifact");
  else if (calibration.repoId !== repoId) missing.push(`the calibration artifact is for ${calibration.repoId}`);
  else if (!calibration.fastPathGate.passed) missing.push("this repo's fast-path calibration gate has not passed");
  return missing.length === 0 ? { unlocked: true, reason: null } : { unlocked: false, reason: missing.join("; ") };
}

/**
 * Where a repo's calibration artifact lives: the configured path, else
 * `<dataDir>/calibration.<owner>__<repo>.json` (what the dashboard writes).
 */
export function calibrationPathFor(
  jev: { readonly calibrationPath?: string | null },
  repoId: string,
  dataDir = ".pullup",
): string {
  return jev.calibrationPath ?? `${dataDir.replace(/\/+$/, "")}/calibration.${repoId.replace("/", "__")}.json`;
}
