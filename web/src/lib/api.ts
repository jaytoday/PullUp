// Typed client for the PullUp API (packages/server). Types come from
// @pullup/core (type-only imports — nothing from core is bundled), so the UI
// can't drift from the engine's shapes.

import type {
  ActionAuthority,
  CalibrationArtifact,
  ConfigChange,
  ConfigFile,
  ConfigPreview,
  ConfigSource,
  ConfigVersionRecord,
  CostCurvePoint,
  CostPriors,
  GuardrailsConfig,
  NamedMode,
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
  AgentRecord,
  AgentStatus,
  CapabilityProfile,
  ControlState,
  CredentialKind,
  EvidenceSheet,
  ChainBreak,
} from "@pullup/core";

export type {
  ActionAuthority,
  CalibrationArtifact,
  ConfigChange,
  ConfigFile,
  ConfigPreview,
  ConfigSource,
  ConfigVersionRecord,
  NamedMode,
  CostCurvePoint,
  JevMode,
  PlannedReviewAction,
  PullDecision,
  PullupReport,
  ReviewActionRecord,
  SignalRunRecord,
  AgentRecord,
  AgentStatus,
  EvidenceSheet,
};

/** Global authority state (GET /api/control). */
export interface ControlResponse {
  readonly stop: ControlState;
  readonly agent: { readonly id: string; readonly version: string; readonly status: AgentStatus; readonly registered: boolean };
  readonly agents: readonly AgentRecord[];
  readonly delivery: "log" | "live";
  readonly permitKey: boolean;
  readonly credential: CredentialKind | null;
}

/** One repo's authority state (GET /api/repos/:id/control). */
export interface RepoControlResponse {
  readonly repoId: string;
  readonly profile: { readonly id: CapabilityProfile; readonly label: string; readonly hint: string; readonly enrolled: boolean; readonly by: string | null; readonly at: string | null };
  /** Null when the stop switch could not be read (PullUp then denies every send). */
  readonly stop: { readonly stopped: boolean; readonly reason: string } | null;
  readonly repoStop: ControlState | null;
  readonly agent: { readonly id: string; readonly version: string; readonly status: AgentStatus | "unknown" };
}

export interface EvidenceResponse extends EvidenceSheet {
  readonly chain: { readonly ok: boolean; readonly checked: number; readonly breaks: readonly ChainBreak[] };
}

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
  readonly guardrails: GuardrailsConfig;
  readonly authority: ActionAuthority;
  readonly hash: string;
  readonly env: { readonly typesafeApiKey: boolean; readonly signalModel: string; readonly signalModelId: string };
  readonly fixtures: readonly string[];
}

export interface ReportResponse {
  /** The repo's action mode (what PullUp may send on GitHub). */
  readonly mode: NamedMode | "custom";
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
    readonly custom: readonly string[];
    readonly texts: Readonly<Record<string, string>>;
  };
  readonly modelId: string;
  readonly units: readonly UnitDetail[];
  readonly curve: readonly CostCurvePoint[];
  readonly plannedAction: PlannedReviewAction | null;
  readonly loggedActions: readonly ReviewActionRecord[];
}

export interface RepoConfigResponse {
  readonly repoId: string;
  readonly path: string | null;
  readonly version: number | null;
  readonly hash: string;
  readonly mode: NamedMode | "custom";
  /** The file layer (pullup.config.json). */
  readonly file: ConfigFile;
  /** The repo layer — what the settings page edits. */
  readonly repo: ConfigFile;
  /** Defaults < file < repo, in file shape. */
  readonly effective: ConfigFile;
  readonly sources: Readonly<Record<string, ConfigSource>>;
  readonly latest: ConfigVersionRecord | null;
  readonly versionCount: number;
  readonly approval: {
    readonly fastPathGatePassed: boolean;
    /** Operator turned live GitHub delivery on (PULLUP_GITHUB_DELIVERY=live). */
    readonly liveActuator: boolean;
    readonly unlocked?: boolean;
    readonly lockedReason?: string | null;
  };
  readonly questionSet: { readonly version: string; readonly builtIn: readonly string[]; readonly escalating: readonly string[] };
}

export interface Issue {
  readonly path: string;
  readonly message: string;
}

export interface ValidateResponse {
  readonly ok: boolean;
  readonly issues: readonly Issue[];
  readonly changes: readonly ConfigChange[];
  readonly loosened: readonly ConfigChange[];
  readonly hash?: string;
  readonly mode?: NamedMode | "custom";
}

export interface SaveResponse {
  readonly version: ConfigVersionRecord;
  readonly changes: readonly ConfigChange[];
}

export type VersionEntry = ConfigVersionRecord & { readonly changes: readonly ConfigChange[] };

export interface SizeStats {
  readonly count: number;
  readonly lines: readonly number[];
  readonly files: readonly number[];
}

export interface TryQuestionResponse {
  readonly question: string;
  readonly pullNumber: number;
  readonly title: string;
  readonly model: string;
  readonly note: string | null;
  readonly units: ReadonlyArray<{ readonly key: string; readonly path: string; readonly p: number | null }>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Extra fields from the error body (issues, needsConfirm, loosened, conflict…). */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) {
    const { error, ...details } = body;
    throw new ApiError(res.status, error ?? `${res.status} ${res.statusText}`, details);
  }
  return body as T;
}

const postJson = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

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
    request<{ logged: ReviewActionRecord[]; delivery?: "log" | "live"; sent: number; failed?: number; denied?: number }>(`${repoPath(repoId)}/actions${q(mode)}`, { method: "POST" }),
  calibrate: (repoId: string) =>
    request<{ path: string; artifact: CalibrationArtifact; run: SignalRunRecord }>(`${repoPath(repoId)}/calibrate`, {
      method: "POST",
    }),
  ingest: (fixture: string) =>
    request<IngestResult>("/api/ingest", { method: "POST", body: JSON.stringify({ fixture }) }),

  repoConfig: (repoId: string) => request<RepoConfigResponse>(`${repoPath(repoId)}/config`),
  configVersions: (repoId: string) => request<VersionEntry[]>(`${repoPath(repoId)}/config/versions`),
  validateConfig: (repoId: string, config: ConfigFile) =>
    postJson<ValidateResponse>(`${repoPath(repoId)}/config/validate`, { config }),
  previewConfig: (repoId: string, config: ConfigFile) =>
    postJson<ConfigPreview>(`${repoPath(repoId)}/config/preview`, { config }),
  saveConfig: (repoId: string, body: { config: ConfigFile; note: string; baseVersion: number | null; confirmLoosen?: string }) =>
    postJson<SaveResponse>(`${repoPath(repoId)}/config`, body),
  restoreConfig: (repoId: string, version: number, body: { baseVersion: number | null; confirmLoosen?: string }) =>
    postJson<SaveResponse>(`${repoPath(repoId)}/config/restore/${version}`, body),
  sizeStats: (repoId: string) => request<SizeStats>(`${repoPath(repoId)}/stats/sizes`),
  tryQuestion: (repoId: string, text: string, pullNumber?: number) =>
    postJson<TryQuestionResponse>(`${repoPath(repoId)}/questions/try`, { text, pullNumber }),

  control: () => request<ControlResponse>("/api/control"),
  repoControl: (repoId: string) => request<RepoControlResponse>(`${repoPath(repoId)}/control`),
  /** Turns the stop switch on. There is deliberately no resume call: resuming is CLI-only. */
  stop: (body: { scope?: string; reason?: string }) => postJson<ControlState>("/api/control/stop", body),
  evidence: (taskId: string) => request<EvidenceResponse>(`/api/tasks/${taskId}/evidence`),
};
