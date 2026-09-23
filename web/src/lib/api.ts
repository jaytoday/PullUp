// Typed client for the PullUp API (packages/server). Types come from
// @pullup/core (type-only imports — nothing from core is bundled), so the UI
// can't drift from the engine's shapes.

import type {
  CalibrationArtifact,
  CostCurvePoint,
  CostPriors,
  IngestResult,
  JevConfig,
  JevMode,
  JevThresholds,
  PlannedReviewAction,
  PolicyResult,
  PolicyRules,
  PullDecision,
  PullupReport,
  ReviewActionRecord,
  SignalRunRecord,
  UnitAnswers,
} from "@pullup/core";

export type {
  CalibrationArtifact,
  CostCurvePoint,
  JevMode,
  PlannedReviewAction,
  PullDecision,
  PullupReport,
  ReviewActionRecord,
  SignalRunRecord,
};

export interface RepoSummary {
  readonly repoId: string;
  readonly ingestedAt: string | null;
  readonly pulls: number;
  readonly open: number;
  readonly lastSignalRun: SignalRunRecord | null;
}

export interface AppConfig {
  readonly path: string | null;
  readonly fileOverrides: readonly string[];
  readonly priors: CostPriors;
  readonly jev: JevConfig;
  readonly policy: PolicyRules;
  readonly env: { readonly typesafeApiKey: boolean; readonly signalModel: string; readonly signalModelId: string };
  readonly fixtures: readonly string[];
}

export interface ReportResponse {
  readonly report: PullupReport;
  readonly actions: readonly PlannedReviewAction[];
  readonly maxWaitByType: Readonly<Record<string, number>>;
}

export interface UnitDetail {
  readonly key: string;
  readonly path: string;
  readonly hunk: string;
  readonly noPatch: boolean;
  readonly oversize: boolean;
  readonly answers: UnitAnswers | null;
}

export interface PullDetail {
  readonly repoId: string;
  readonly generatedAt: string;
  readonly pull: {
    readonly number: number;
    readonly title: string;
    readonly author: string;
    readonly state: string;
    readonly headSha: string;
    readonly createdAt: string;
    readonly labels: readonly string[];
    readonly files: readonly string[];
    readonly additions: number;
    readonly deletions: number;
    readonly changeType: string;
    readonly area: string;
    readonly sizeBucket: string;
  };
  readonly decision: PullDecision;
  readonly policy: PolicyResult;
  readonly thresholds: JevThresholds;
  readonly questionSet: {
    readonly version: string;
    readonly sensitive: readonly string[];
    readonly escalating: readonly string[];
    readonly injection: string;
    readonly lowRisk: readonly string[];
  };
  readonly modelId: string;
  readonly units: readonly UnitDetail[];
  readonly curve: readonly CostCurvePoint[];
  readonly plannedAction: PlannedReviewAction | null;
  readonly loggedActions: readonly ReviewActionRecord[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

const repoPath = (repoId: string) => `/api/repos/${repoId}`;
const q = (mode: JevMode) => `?mode=${mode}`;

export const api = {
  config: () => request<AppConfig>("/api/config"),
  repos: () => request<RepoSummary[]>("/api/repos"),
  report: (repoId: string, mode: JevMode) => request<ReportResponse>(`${repoPath(repoId)}/report${q(mode)}`),
  pull: (repoId: string, n: number, mode: JevMode) => request<PullDetail>(`${repoPath(repoId)}/pulls/${n}${q(mode)}`),
  actions: (repoId: string) => request<ReviewActionRecord[]>(`${repoPath(repoId)}/actions`),
  signalRuns: (repoId: string) => request<SignalRunRecord[]>(`${repoPath(repoId)}/signal-runs`),
  /** `artifact` is null until calibration has run. */
  calibration: (repoId: string) =>
    request<{ path: string; artifact: CalibrationArtifact | null }>(`${repoPath(repoId)}/calibration`),
  runSignals: (repoId: string) =>
    request<{ run: SignalRunRecord; note: string | null }>(`${repoPath(repoId)}/signals`, {
      method: "POST",
      body: JSON.stringify({ scope: "open" }),
    }),
  logActions: (repoId: string, mode: JevMode) =>
    request<{ logged: ReviewActionRecord[]; sent: number }>(`${repoPath(repoId)}/actions${q(mode)}`, { method: "POST" }),
  calibrate: (repoId: string) =>
    request<{ path: string; artifact: CalibrationArtifact; run: SignalRunRecord }>(`${repoPath(repoId)}/calibrate`, {
      method: "POST",
    }),
  ingest: (fixture: string) =>
    request<IngestResult>("/api/ingest", { method: "POST", body: JSON.stringify({ fixture }) }),
};
