// The resolved Jev layer handed to buildReport: config + policy + question set
// + the model id whose cached answers to read + an optional calibration.
// Assessment reads only cached signals — buildReport never calls a model.

import type { CostParams } from "../cost/params.js";
import type { RiskOverlay } from "../cost/decision.js";
import { defectProbability } from "../cost/model.js";
import type { PolicyRules } from "../policy/policy.js";
import { evaluatePolicy } from "../policy/policy.js";
import type { PullRecord } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";
import type { RiskAssessment } from "./aggregate.js";
import { assessPull } from "./aggregate.js";
import type { CalibrationArtifact } from "./calibrate.js";
import type { JevConfig, JevMode, RiskWeights } from "./config.js";
import { loadPullSignals } from "./run.js";
import type { QuestionSet } from "./types.js";

export interface JevRuntime {
  readonly config: JevConfig;
  readonly policy: PolicyRules;
  readonly qs: QuestionSet;
  /** Model id whose cached answers are read (e.g. "jev-1.13.0", "synthetic-v1"). */
  readonly modelId: string;
  readonly calibration: CalibrationArtifact | null;
  readonly notes?: readonly string[];
}

export interface RiskSummary {
  readonly mode: Exclude<JevMode, "off">;
  readonly modelId: string;
  readonly questionSetVersion: string;
  readonly calibration: { readonly hash: string; readonly passed: boolean; readonly repoId: string } | null;
  readonly weightsSource: "calibration" | "config (uncalibrated)";
  readonly notes: readonly string[];
  readonly counts: {
    readonly escalate: number;
    readonly reviewWithRationale: number;
    readonly standard: number;
    readonly fastPath: number;
  };
  readonly units: { readonly total: number; readonly evaluated: number };
}

export function resolveWeights(
  rt: JevRuntime,
  repoId: string,
): { weights: RiskWeights; calibrated: boolean; notes: string[] } {
  const notes: string[] = [];
  const cal = rt.calibration;
  if (!cal) {
    notes.push("No calibration artifact: risk multiplier fixed at 1 (policy + escalation still apply in active mode).");
    return { weights: rt.config.weights, calibrated: false, notes };
  }
  const problems: string[] = [];
  if (!cal.gate.passed) problems.push("promotion gate not passed");
  if (cal.modelId !== rt.modelId) problems.push(`model ${cal.modelId} ≠ ${rt.modelId}`);
  if (cal.questionSetVersion !== rt.qs.version) problems.push(`question set ${cal.questionSetVersion} ≠ ${rt.qs.version}`);
  if (cal.repoId !== repoId) problems.push(`calibrated on ${cal.repoId}, not ${repoId}`);
  if (problems.length > 0) {
    notes.push(`Calibration ${cal.hash} not applied (${problems.join("; ")}): multiplier fixed at 1.`);
    return { weights: rt.config.weights, calibrated: false, notes };
  }
  return { weights: cal.weights, calibrated: true, notes };
}

export async function assessOpenPulls(
  store: PullStore,
  repoId: string,
  params: CostParams,
  rt: JevRuntime,
): Promise<{ overlays: Map<number, RiskOverlay>; summary: RiskSummary; assessments: RiskAssessment[] }> {
  const mode = rt.config.mode as Exclude<JevMode, "off">;
  const { weights, calibrated, notes } = resolveWeights(rt, repoId);
  const pulls: PullRecord[] = (await store.listPulls(repoId)).filter((p) => p.state === "open");
  const overlays = new Map<number, RiskOverlay>();
  const assessments: RiskAssessment[] = [];
  let unitsTotal = 0;
  let unitsEvaluated = 0;
  for (const pull of pulls) {
    const signals = await loadPullSignals(store, pull, rt.qs, rt.modelId);
    const assessment = assessPull({
      pull,
      policy: evaluatePolicy(pull.files, rt.policy),
      signals,
      qs: rt.qs,
      config: rt.config,
      weights,
      calibrated,
      baseDefectProbability: defectProbability(params, pull.changeType),
    });
    unitsTotal += assessment.unitsTotal;
    unitsEvaluated += assessment.unitsEvaluated;
    assessments.push(assessment);
    overlays.set(pull.number, { mode, assessment });
  }
  if (pulls.length > 0 && unitsTotal === 0) {
    notes.push("No diff hunks stored for open PRs — ingest with a source that supplies patches.");
  } else if (unitsEvaluated < unitsTotal) {
    notes.push(`${unitsTotal - unitsEvaluated}/${unitsTotal} units have no cached answers — run \`pullup signals\`.`);
  }
  const count = (b: RiskAssessment["band"]) => assessments.filter((a) => a.band === b).length;
  return {
    overlays,
    assessments,
    summary: {
      mode,
      modelId: rt.modelId,
      questionSetVersion: rt.qs.version,
      calibration: rt.calibration
        ? { hash: rt.calibration.hash, passed: rt.calibration.gate.passed, repoId: rt.calibration.repoId }
        : null,
      weightsSource: calibrated ? "calibration" : "config (uncalibrated)",
      notes: [...(rt.notes ?? []), ...notes],
      counts: {
        escalate: count("escalate"),
        reviewWithRationale: count("review-with-rationale"),
        standard: count("standard"),
        fastPath: count("fast-path"),
      },
      units: { total: unitsTotal, evaluated: unitsEvaluated },
    },
  };
}
