// Persistent records of the authority layer (stored through PullStore).
//
//   ControlState    — the stop switch, globally or for one repo (RES-01)
//   RepoEnrollment  — which capability profile a repo is enrolled in (CON-04)
//   AgentRecord     — one row per agent id × composition hash (DIS-01, RES-02)
//   EvidenceRecord  — append-only, hash-chained per repo (OBS-05, OBS-06)

import type { CapabilityProfile } from "./profiles.js";

/** `scope` is "global" or a repo id. */
export interface ControlState {
  readonly scope: string;
  readonly stopped: boolean;
  readonly reason: string;
  readonly by: string;
  readonly at: string;
}

export const GLOBAL_SCOPE = "global";

export interface RepoEnrollment {
  readonly repoId: string;
  readonly profile: CapabilityProfile;
  readonly by: string;
  readonly at: string;
}

/**
 *   pending     — seen, not yet approved: may only comment (Q4)
 *   approved    — an operator approved this exact composition
 *   quarantined — every permit for it is denied (RES-02)
 */
export type AgentStatus = "pending" | "approved" | "quarantined";

export interface AgentRecord {
  /** e.g. `pullup/eve`, `pullup/cli`, `pullup/dashboard`. */
  readonly agentId: string;
  /** The composition hash. */
  readonly version: string;
  readonly status: AgentStatus;
  /** What was hashed (file paths → content hashes, versions), for DIS-05 queries. */
  readonly inputs: Readonly<Record<string, string>>;
  readonly firstSeen: string;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
  readonly note: string;
}

export const EVIDENCE_KINDS = [
  "planned",
  "authorized",
  "denied",
  "credential",
  "sent",
  "logged",
  "skipped",
  "verified",
  "failed",
  "revoked",
  "control",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceRecord {
  readonly repoId: string;
  /** 1-based position in this repo's chain. */
  readonly seq: number;
  /** Null for control events (stop, resume, quarantine) that belong to no task. */
  readonly taskId: string | null;
  readonly agentVersion: string | null;
  readonly kind: EvidenceKind;
  readonly at: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly prevHash: string | null;
  readonly hash: string;
}

export type NewEvidence = Omit<EvidenceRecord, "seq" | "prevHash" | "hash">;

export interface EvidenceQuery {
  readonly repoId?: string;
  readonly taskId?: string;
  readonly agentVersion?: string;
}
