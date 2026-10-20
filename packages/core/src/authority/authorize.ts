// The authorizer (Agent Baseline AUT-02, AUT-06, CON-04): decides whether
// PullUp may *send* what it has already decided — separately from the
// decision, and as an explicit allow or deny with reasons.
//
//   PullUp decides (planReviewActions) → the authorizer authorizes (here)
//   → GitHub enforces (scoped token) → evidence proves what happened.
//
// Pure and offline. `governActions` runs after `planReviewActions` (which is
// unchanged) and gives every planned action a task, an authorization and —
// for a live send — a signed permit. It can only lower what is sent, never
// raise it, and never changes the decision itself.

import { randomBytes } from "node:crypto";
import type { AuthorityLevel } from "../actions/authority.js";
import { AUTHORITY_RANK } from "../actions/authority.js";
import type { DeliveryMode } from "../actions/approval.js";
import type { BotReviewAction, PlannedReviewAction } from "../actions/review.js";
import { AUTHORITY_KEY, DECISION_COMMENT_MARKER, decisionCommentBody, plannedCheckRun } from "../actions/review.js";
import { callHash, issuePermit } from "./permit.js";
import type { CapabilityProfile, CredentialKind, GitHubPermissions } from "./profiles.js";
import { PROFILE_CEILING, PROFILE_LABEL, requiredPermissions } from "./profiles.js";
import type { AgentStatus } from "./records.js";

export type InitiatorKind = "webhook" | "cli" | "dashboard" | "agent";

/** One planned action as a unit of delegated work (AUT-01 attribution, OBS-02 correlation). */
export interface PullUpTask {
  readonly taskId: string;
  readonly initiator: { readonly kind: InitiatorKind; readonly ref: string | null };
  readonly agent: { readonly id: string; readonly version: string };
  readonly repoId: string;
  readonly pullNumber: number;
  readonly headSha: string;
  readonly action: BotReviewAction;
  readonly config: { readonly version: number | null; readonly hash: string };
  readonly risk: { readonly band: string | null; readonly questionSet: string | null; readonly modelId: string | null };
  readonly decisionSource: PlannedReviewAction["source"];
  readonly createdAt: string;
}

export type AuthorizationDecision = "allow" | "allow-comment-only" | "deny";

export interface Authorization {
  readonly decision: AuthorizationDecision;
  readonly reasons: readonly string[];
  /** Agent Baseline controls this decision evidences. */
  readonly controls: readonly string[];
  readonly profile: CapabilityProfile;
  /** The level the action mode (and approval gate) asked for. */
  readonly requested: AuthorityLevel;
  /** What may actually be sent ("off" when denied). */
  readonly effective: AuthorityLevel;
  /** The minimum GitHub permissions for `effective` (empty when nothing is sent). */
  readonly permissions: GitHubPermissions;
  /** The credential a live send would use (null in log mode or when none is configured). */
  readonly credential: CredentialKind | null;
}

/** What the authorizer reads about the world. Loaded by `loadControlSnapshot`. */
export interface ControlSnapshot {
  readonly profile: CapabilityProfile;
  readonly agentStatus: AgentStatus | "unknown";
  /** Null when the stop switch could not be read (→ deny, fail closed). */
  readonly stop: { readonly stopped: boolean; readonly reason: string } | null;
}

export interface AuthorizationContext extends ControlSnapshot {
  readonly delivery: DeliveryMode;
  readonly credential: CredentialKind | null;
  readonly permitKey: boolean;
}

const lower = (a: AuthorityLevel, b: AuthorityLevel): AuthorityLevel => (AUTHORITY_RANK[a] <= AUTHORITY_RANK[b] ? a : b);

/** Authorizes one task at the level its action mode asked for. */
export function authorize(task: Pick<PullUpTask, "action">, requested: AuthorityLevel, ctx: AuthorizationContext): Authorization {
  const live = ctx.delivery === "live";
  const credential = live ? ctx.credential : null;
  const base = { profile: ctx.profile, requested, credential };

  if (requested === "off") {
    return { ...base, decision: "allow", reasons: ["Action mode is off for this action: nothing is sent."], controls: [], effective: "off", permissions: {} };
  }

  const denied: string[] = [];
  const controls = new Set<string>();
  const deny = (reason: string, control: string) => {
    denied.push(reason);
    controls.add(control);
  };
  if (ctx.stop === null) deny("The stop switch could not be read.", "AUT-06");
  else if (ctx.stop.stopped) deny(`PullUp is stopped${ctx.stop.reason ? ` ${ctx.stop.reason}` : ""}.`, "RES-01");
  if (ctx.agentStatus === "quarantined") deny("This agent version is quarantined.", "RES-02");
  if (ctx.agentStatus === "unknown") deny("This agent's version could not be determined.", "AUT-06");
  if (live && !ctx.permitKey) deny("PULLUP_PERMIT_KEY is not set, so no permit can be issued.", "AUT-06");
  if (live && !ctx.credential) deny("No GitHub credential is configured.", "AUT-06");
  if (denied.length > 0) {
    return { ...base, decision: "deny", reasons: denied, controls: [...controls], effective: "off", permissions: {} };
  }

  const reasons: string[] = [];
  let effective: AuthorityLevel = requested;
  const ceiling = PROFILE_CEILING[ctx.profile][AUTHORITY_KEY[task.action]];
  if (AUTHORITY_RANK[ceiling] < AUTHORITY_RANK[effective]) {
    effective = lower(effective, ceiling);
    reasons.push(`This repo is enrolled in the ${PROFILE_LABEL[ctx.profile]} profile, which allows at most a comment for this action.`);
    controls.add("CON-04");
  }
  if (ctx.agentStatus === "pending" && effective === "act") {
    effective = "comment";
    reasons.push("This agent version has not been approved yet (pullup agents approve), so it may only comment.");
    controls.add("DIS-01");
  }
  if (live && ctx.credential === "standing-token" && effective === "act") {
    effective = "comment";
    reasons.push("Acting needs a GitHub App credential that can be narrowed to one repo; a personal token may only comment.");
    controls.add("AUT-04");
  }
  controls.add("AUT-02");
  const decision: AuthorizationDecision = effective === requested ? "allow" : "allow-comment-only";
  if (decision === "allow") reasons.push(`Allowed at ${effective} by the ${PROFILE_LABEL[ctx.profile]} profile.`);
  return {
    ...base,
    decision,
    reasons,
    controls: [...controls],
    effective,
    permissions: requiredPermissions(effective, effective === "comment" || task.action === "defer_to_human"),
  };
}

/** Time-sortable task id: base36 milliseconds + random suffix. */
export function newTaskId(now: string = new Date().toISOString()): string {
  return `t_${Date.parse(now).toString(36).padStart(9, "0")}${randomBytes(5).toString("hex")}`;
}

/** Marker linking PullUp's comment to the task that wrote it. */
export function taskMarker(taskId: string): string {
  return `<!-- pullup:task=${taskId} -->`;
}

/**
 * Reshapes a planned action to a lower level. `comment` becomes PullUp's single
 * decision comment ("PullUp would …"); `off` sends nothing.
 */
export function lowerAction(planned: PlannedReviewAction, level: AuthorityLevel): PlannedReviewAction {
  // A lowered level also lowers the check: off → none, comment → neutral "would …".
  const check = (lvl: AuthorityLevel) => {
    const checkRun = plannedCheckRun(planned, lvl, planned.clamped ?? null);
    return checkRun === undefined ? {} : { checkRun };
  };
  if (level === "off") {
    return { ...planned, call: { createReview: null, upsertComment: null, requestReviewers: null, ...check("off") } };
  }
  if (level !== "comment" || planned.authority === "comment") return planned;
  const [owner, repo] = planned.repoId.split("/") as [string, string];
  const body = decisionCommentBody({ ...planned, reason: planned.rationale ?? planned.reason }, "comment");
  return {
    ...planned,
    authority: "comment",
    call: {
      createReview: null,
      upsertComment: { owner, repo, issue_number: planned.pullNumber, marker: DECISION_COMMENT_MARKER, body },
      requestReviewers: null,
      ...check("comment"),
    },
  };
}

export interface GovernInput {
  readonly initiator: PullUpTask["initiator"];
  readonly agent: { readonly id: string; readonly version: string };
  readonly config: { readonly version: number | null; readonly hash: string };
  readonly risk?: { readonly questionSet: string | null; readonly modelId: string | null };
  readonly snapshot: ControlSnapshot;
  readonly delivery: DeliveryMode;
  readonly credential: CredentialKind | null;
  /** Needed to sign permits; null → live sends are denied. */
  readonly permitKey: string | null;
  /** Issue permits (side-effecting paths only; read-only views pass false). */
  readonly sign: boolean;
  readonly now: string;
  readonly newTaskId?: (now: string) => string;
}

/**
 * Wraps each planned action in a task, authorizes it, lowers it to what is
 * allowed and — for a live send — attaches a permit. Pure apart from the
 * random task id and nonce.
 */
export function governActions(planned: readonly PlannedReviewAction[], input: GovernInput): PlannedReviewAction[] {
  const mkId = input.newTaskId ?? newTaskId;
  return planned.map((p) => {
    const taskId = mkId(input.now);
    const task: PullUpTask = {
      taskId,
      initiator: input.initiator,
      agent: input.agent,
      repoId: p.repoId,
      pullNumber: p.pullNumber,
      headSha: p.headSha,
      action: p.action,
      config: input.config,
      risk: { band: p.band, questionSet: input.risk?.questionSet ?? null, modelId: input.risk?.modelId ?? null },
      decisionSource: p.source,
      createdAt: input.now,
    };
    const requested = p.authority ?? "act";
    const authorization = authorize(task, requested, {
      ...input.snapshot,
      delivery: input.delivery,
      credential: input.credential,
      permitKey: input.permitKey !== null,
    });
    let governed = lowerAction(p, authorization.effective);
    const upsert = governed.call.upsertComment;
    if (upsert) {
      governed = { ...governed, call: { ...governed.call, upsertComment: { ...upsert, body: `${upsert.body}\n${taskMarker(taskId)}` } } };
    }
    // A check run needs checks: write on the action's token.
    const permissions = governed.call.checkRun
      ? { ...authorization.permissions, checks: "write" as const }
      : authorization.permissions;
    governed = { ...governed, taskId, task, authorization: { ...authorization, permissions } };
    if (
      input.sign &&
      input.permitKey &&
      input.delivery === "live" &&
      authorization.decision !== "deny" &&
      authorization.effective !== "off"
    ) {
      const permit = issuePermit(
        {
          taskId,
          repoId: p.repoId,
          pullNumber: p.pullNumber,
          headSha: p.headSha,
          action: p.action,
          level: authorization.effective,
          configHash: input.config.hash,
          agentId: input.agent.id,
          agentVersion: input.agent.version,
          permissions,
          callHash: callHash(governed.call),
        },
        input.permitKey,
        { now: input.now },
      );
      governed = { ...governed, permit };
    }
    return governed;
  });
}
