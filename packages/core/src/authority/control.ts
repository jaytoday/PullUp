// The operator's controls and the execution-time re-check.
//
//   stop / resume      — RES-01. Stop is safe from anywhere (it only removes
//                        authority); resume is CLI-only (Q3).
//   enroll             — CON-04. CLI-only: it can widen what PullUp may send.
//   agents approve /
//   quarantine         — DIS-01, RES-02.
//   checkExecution     — AUT-02, AUT-06: re-validates a permit against the
//                        world *now*, immediately before any GitHub call.
//   impact             — RES-03: what one agent version touched.

import type { PlannedReviewAction } from "../actions/review.js";
import type { PullStore } from "../schema/store.js";
import type { ControlSnapshot, GovernInput } from "./authorize.js";
import { governActions } from "./authorize.js";
import type { AgentIdentity } from "./composition.js";
import { UNKNOWN_VERSION } from "./composition.js";
import { appendEvidence } from "./evidence.js";
import { callHash, verifyPermit } from "./permit.js";
import type { CapabilityProfile } from "./profiles.js";
import { DEFAULT_PROFILE } from "./profiles.js";
import type { AgentRecord, AgentStatus, ControlState, EvidenceRecord } from "./records.js";
import { GLOBAL_SCOPE } from "./records.js";

/** Global + repo stop state. Throws if unreadable (callers fail closed). */
async function readStop(store: PullStore, repoId: string): Promise<{ stopped: boolean; reason: string }> {
  const [global, repo] = await Promise.all([store.getControlState(GLOBAL_SCOPE), store.getControlState(repoId)]);
  const hit = [global, repo].find((s) => s?.stopped);
  return hit ? { stopped: true, reason: `${hit.scope === GLOBAL_SCOPE ? "everywhere" : `on ${hit.scope}`} by ${hit.by}${hit.reason ? ` (${hit.reason})` : ""}` } : { stopped: false, reason: "" };
}

/** Everything the authorizer reads, loaded read-only. Any read error → the fail-closed value. */
export async function loadControlSnapshot(
  store: PullStore,
  repoId: string,
  agent: Pick<AgentIdentity, "id" | "version">,
): Promise<ControlSnapshot> {
  const stop = await readStop(store, repoId).catch(() => null);
  const profile = await store
    .getEnrollment(repoId)
    .then((e) => e?.profile ?? DEFAULT_PROFILE)
    .catch(() => DEFAULT_PROFILE);
  let agentStatus: ControlSnapshot["agentStatus"] = "unknown";
  if (agent.version !== UNKNOWN_VERSION) {
    agentStatus = await store
      .getAgent(agent.id, agent.version)
      .then((r) => r?.status ?? "pending")
      .catch(() => "unknown" as const);
  }
  return { profile, agentStatus, stop };
}

/** Registers an agent version the first time it is seen (as `pending`). */
export async function ensureAgent(store: PullStore, agent: AgentIdentity, now: string): Promise<AgentRecord | null> {
  if (agent.version === UNKNOWN_VERSION) return null;
  const known = await store.getAgent(agent.id, agent.version);
  if (known) return known;
  const rec: AgentRecord = {
    agentId: agent.id,
    version: agent.version,
    status: "pending",
    inputs: agent.inputs,
    firstSeen: now,
    updatedAt: now,
    updatedBy: null,
    note: "",
  };
  await store.upsertAgent(rec);
  return rec;
}

/** Turns the stop switch on (scope "global" or a repo id). */
export async function stopPullUp(
  store: PullStore,
  input: { readonly scope?: string; readonly reason?: string; readonly by: string; readonly now: string },
): Promise<ControlState> {
  const state: ControlState = { scope: input.scope ?? GLOBAL_SCOPE, stopped: true, reason: input.reason ?? "", by: input.by, at: input.now };
  await store.setControlState(state);
  await appendEvidence(store, {
    repoId: state.scope,
    taskId: null,
    agentVersion: null,
    kind: "control",
    at: input.now,
    payload: { control: "stop", scope: state.scope, reason: state.reason, by: state.by },
  });
  return state;
}

/** Turns the stop switch off. CLI only. */
export async function resumePullUp(
  store: PullStore,
  input: { readonly scope?: string; readonly by: string; readonly now: string },
): Promise<ControlState> {
  const state: ControlState = { scope: input.scope ?? GLOBAL_SCOPE, stopped: false, reason: "", by: input.by, at: input.now };
  await store.setControlState(state);
  await appendEvidence(store, {
    repoId: state.scope,
    taskId: null,
    agentVersion: null,
    kind: "control",
    at: input.now,
    payload: { control: "resume", scope: state.scope, by: state.by },
  });
  return state;
}

export async function enrollRepo(
  store: PullStore,
  input: { readonly repoId: string; readonly profile: CapabilityProfile; readonly by: string; readonly now: string },
): Promise<void> {
  await store.setEnrollment({ repoId: input.repoId, profile: input.profile, by: input.by, at: input.now });
  await appendEvidence(store, {
    repoId: input.repoId,
    taskId: null,
    agentVersion: null,
    kind: "control",
    at: input.now,
    payload: { control: "enroll", profile: input.profile, by: input.by },
  });
}

/** Matches agent rows by full hash or a unique prefix (≥ 6 chars). */
export async function findAgents(store: PullStore, versionPrefix: string): Promise<AgentRecord[]> {
  if (versionPrefix.length < 6) return [];
  return (await store.listAgents()).filter((a) => a.version.startsWith(versionPrefix));
}

export async function setAgentStatus(
  store: PullStore,
  input: { readonly agent: AgentRecord; readonly status: AgentStatus; readonly by: string; readonly note?: string; readonly now: string },
): Promise<AgentRecord> {
  const rec: AgentRecord = { ...input.agent, status: input.status, updatedAt: input.now, updatedBy: input.by, note: input.note ?? "" };
  await store.upsertAgent(rec);
  await appendEvidence(store, {
    repoId: GLOBAL_SCOPE,
    taskId: null,
    agentVersion: rec.version,
    kind: "control",
    at: input.now,
    payload: { control: `agent-${input.status}`, agentId: rec.agentId, version: rec.version, by: input.by, note: rec.note },
  });
  return rec;
}

export interface ExecutionGuard {
  readonly permitKey: string | null;
  /** The identity of the process about to send (must match the permit). */
  readonly agent: { readonly id: string; readonly version: string };
  /** The repo's effective config hash *now*. */
  readonly configHash: (repoId: string) => Promise<string>;
}

/**
 * Re-validates a governed action immediately before any GitHub call. Returns
 * the reasons to deny (empty = proceed). Consumes the permit's nonce last, so
 * a permit can be used once.
 */
export async function checkExecution(
  store: PullStore,
  a: PlannedReviewAction,
  guard: ExecutionGuard,
  now: string,
): Promise<string[]> {
  if (!a.authorization || !a.task || !a.taskId) return ["This action was never authorized (no task)."];
  if (a.authorization.decision === "deny") return [...a.authorization.reasons];
  const bad = verifyPermit(a.permit, guard.permitKey, now);
  if (bad) return [`Permit refused: ${bad}.`];
  const c = a.permit!.claims;
  const reasons: string[] = [];
  const bind = (ok: boolean, what: string) => {
    if (!ok) reasons.push(`Permit does not match this action (${what}).`);
  };
  bind(c.taskId === a.taskId, "task");
  bind(c.repoId === a.repoId && c.pullNumber === a.pullNumber, "pull request");
  bind(c.headSha === a.headSha, "head commit");
  bind(c.action === a.action, "action");
  bind(c.level === (a.authority ?? "act") && c.level === a.authorization.effective, "level");
  bind(c.callHash === callHash(a.call), "GitHub call");
  bind(c.agentId === guard.agent.id && c.agentVersion === guard.agent.version, "agent version");
  if (reasons.length > 0) return reasons;

  try {
    const stop = await readStop(store, a.repoId);
    if (stop.stopped) reasons.push(`PullUp is stopped ${stop.reason}.`);
  } catch {
    reasons.push("The stop switch could not be read.");
  }
  try {
    const agent = await store.getAgent(c.agentId, c.agentVersion);
    if (agent?.status === "quarantined") reasons.push("This agent version was quarantined.");
    else if (c.level === "act" && agent?.status !== "approved") reasons.push("This agent version is not approved to act.");
  } catch {
    reasons.push("The agent registry could not be read.");
  }
  try {
    const hash = await guard.configHash(a.repoId);
    if (hash !== c.configHash) reasons.push("The repo's config changed after this action was authorized.");
  } catch {
    reasons.push("The repo's current config could not be read.");
  }
  if (reasons.length > 0) return reasons;
  if (!(await store.consumePermitNonce(c.nonce, c.taskId, now))) return ["Permit was already used."];
  return [];
}

export interface ImpactRow {
  readonly taskId: string;
  readonly repoId: string;
  readonly pullNumber: number | null;
  readonly action: string | null;
  readonly outcome: string | null;
  readonly at: string;
  readonly github: { readonly reviewId?: number; readonly commentId?: number; readonly reviewersRequested?: readonly string[] };
}

/** Every task an agent version ran and what it touched on GitHub (RES-03). */
export function impactOf(rows: readonly EvidenceRecord[]): ImpactRow[] {
  const byTask = new Map<string, EvidenceRecord[]>();
  for (const r of rows) if (r.taskId) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r]);
  return [...byTask.entries()]
    .map(([taskId, rs]) => {
      rs.sort((x, y) => x.seq - y.seq);
      const task = (rs.find((r) => r.kind === "planned")?.payload as { task?: { pullNumber?: number; action?: string } } | undefined)?.task;
      const last = rs.at(-1)!;
      const delivery = (rs.filter((r) => "delivery" in r.payload).at(-1)?.payload as { delivery?: { reviewId?: number; commentId?: number; reviewersRequested?: string[] } | null } | undefined)?.delivery;
      return {
        taskId,
        repoId: last.repoId,
        pullNumber: task?.pullNumber ?? null,
        action: task?.action ?? null,
        outcome: last.kind,
        at: rs[0]!.at,
        github: {
          ...(delivery?.reviewId != null ? { reviewId: delivery.reviewId } : {}),
          ...(delivery?.commentId != null ? { commentId: delivery.commentId } : {}),
          ...(delivery?.reviewersRequested ? { reviewersRequested: delivery.reviewersRequested } : {}),
        },
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** loadControlSnapshot + governActions: the one call every surface makes after planning. */
export async function governPlan(
  store: PullStore,
  planned: readonly PlannedReviewAction[],
  input: Omit<GovernInput, "snapshot"> & { readonly repoId: string },
): Promise<PlannedReviewAction[]> {
  const snapshot = await loadControlSnapshot(store, input.repoId, input.agent);
  return governActions(planned, { ...input, snapshot });
}
