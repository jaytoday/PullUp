// Jev layer configuration (`jev` key of pullup.config.json). Everything that
// shapes a decision — model id, question set, thresholds, weights, calibration
// — is explicit, versioned, and shows up in report provenance.

import { z } from "zod";

export type JevMode = "off" | "shadow" | "active";

export interface JevThresholds {
  /** An escalating signal at/above this → escalate to a human. */
  readonly sensitiveHigh: number;
  /** Any sensitive signal in [medium, high) → review-with-rationale. */
  readonly sensitiveMedium: number;
  /** Injection tripwire at/above this → escalate. */
  readonly injection: number;
  /** Fast-path: every sensitive + injection signal must be below this. */
  readonly fastPathMaxRisk: number;
  /** Fast-path: formatting-only evidence must be at/above this. */
  readonly fastPathMinLowRisk: number;
  /** Fast-path: change-kind Choice confidence must be at/above this. */
  readonly fastPathMinConfidence: number;
}

export interface RiskWeights {
  readonly intercept: number;
  readonly features: Readonly<Record<string, number>>;
}

export interface PromotionGate {
  readonly minMerged: number;
  readonly minDefects: number;
  readonly minAuroc: number;
  readonly maxEce: number;
  readonly minFastPathPrecision: number;
}

export interface JevConfig {
  readonly mode: JevMode;
  /** Pinned model id — never `jev-latest` once thresholds are tuned. */
  readonly model: string;
  readonly questionSet: string;
  readonly thresholds: JevThresholds;
  /** Hand-set weights used until a passing calibration replaces them. */
  readonly weights: RiskWeights;
  /** Bounds on the P_defect multiplier m. Only m ≥ 1 is ever applied. */
  readonly multiplierMin: number;
  readonly multiplierMax: number;
  /** Path to a calibration artifact written by `pullup calibrate`. */
  readonly calibrationPath: string | null;
  readonly budgetUsdPerRun: number;
  readonly concurrency: number;
  readonly requestsPerMinute: number;
  /** Reviewers requested when the bot defers to a human. */
  readonly humanReviewers: readonly string[];
  readonly gate: PromotionGate;
}

const SENSITIVE_DEFAULT_WEIGHT = 1.2;

export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  // logit(0.05): a PR with no risk signals sits at the ~5% repo prior.
  intercept: -2.944,
  features: {
    "max:touchesAuthn": SENSITIVE_DEFAULT_WEIGHT,
    "max:touchesAuthz": SENSITIVE_DEFAULT_WEIGHT,
    "max:handlesSecrets": SENSITIVE_DEFAULT_WEIGHT,
    "max:addsNetworkCall": SENSITIVE_DEFAULT_WEIGHT,
    "max:changesDependencyManifest": SENSITIVE_DEFAULT_WEIGHT,
    "max:weakensInputValidation": SENSITIVE_DEFAULT_WEIGHT,
    "max:removesErrorHandling": SENSITIVE_DEFAULT_WEIGHT,
    "max:changesDbSchema": SENSITIVE_DEFAULT_WEIGHT,
    "max:changesConcurrency": SENSITIVE_DEFAULT_WEIGHT,
    "max:addressesReviewerOrAutomation": 1.5,
    blastMax: 1.5,
    lowRiskMin: -1.5,
    logUnits: 0.3,
  },
};

export const DEFAULT_JEV_CONFIG: JevConfig = {
  mode: "off",
  model: "jev-1.13.0",
  questionSet: "q-v1",
  thresholds: {
    sensitiveHigh: 0.85,
    sensitiveMedium: 0.5,
    injection: 0.5,
    fastPathMaxRisk: 0.1,
    fastPathMinLowRisk: 0.9,
    fastPathMinConfidence: 0.8,
  },
  weights: DEFAULT_RISK_WEIGHTS,
  multiplierMin: 0.25,
  multiplierMax: 4,
  calibrationPath: null,
  budgetUsdPerRun: 1,
  concurrency: 8,
  requestsPerMinute: 1200,
  humanReviewers: [],
  gate: {
    minMerged: 200,
    minDefects: 20,
    minAuroc: 0.75,
    maxEce: 0.05,
    minFastPathPrecision: 0.98,
  },
};

const unit = z.number().min(0).max(1);

export const jevConfigSchema = z
  .object({
    mode: z.enum(["off", "shadow", "active"]).optional(),
    model: z.string().min(1).optional(),
    questionSet: z.string().min(1).optional(),
    thresholds: z
      .object({
        sensitiveHigh: unit.optional(),
        sensitiveMedium: unit.optional(),
        injection: unit.optional(),
        fastPathMaxRisk: unit.optional(),
        fastPathMinLowRisk: unit.optional(),
        fastPathMinConfidence: unit.optional(),
      })
      .strict()
      .optional(),
    weights: z
      .object({ intercept: z.number(), features: z.record(z.string(), z.number()) })
      .strict()
      .optional(),
    multiplierMin: z.number().min(0).max(1).optional(),
    multiplierMax: z.number().min(1).optional(),
    calibrationPath: z.string().nullable().optional(),
    budgetUsdPerRun: z.number().min(0).optional(),
    concurrency: z.number().int().min(1).max(64).optional(),
    requestsPerMinute: z.number().int().min(1).optional(),
    humanReviewers: z.array(z.string()).optional(),
    gate: z
      .object({
        minMerged: z.number().int().min(0).optional(),
        minDefects: z.number().int().min(0).optional(),
        minAuroc: unit.optional(),
        maxEce: unit.optional(),
        minFastPathPrecision: unit.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type JevConfigFile = z.infer<typeof jevConfigSchema>;

export function resolveJevConfig(file: JevConfigFile = {}): JevConfig {
  return {
    ...DEFAULT_JEV_CONFIG,
    ...file,
    thresholds: { ...DEFAULT_JEV_CONFIG.thresholds, ...file.thresholds },
    weights: file.weights ?? DEFAULT_JEV_CONFIG.weights,
    gate: { ...DEFAULT_JEV_CONFIG.gate, ...file.gate },
    calibrationPath: file.calibrationPath ?? null,
    humanReviewers: file.humanReviewers ?? [],
  };
}
