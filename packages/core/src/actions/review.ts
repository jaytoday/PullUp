// Bot review actions. A code-review bot acts on a pull through the GitHub
// pull-request review API:
//
//   approve          → pulls.createReview { event: "APPROVE" }
//   request_changes  → pulls.createReview { event: "REQUEST_CHANGES" }
//   defer_to_human   → pulls.createReview { event: "COMMENT" } + pulls.requestReviewers
//
// With an action authority (actions/authority.ts) each planned action is then
// shaped by what PullUp may *send*: `act` keeps the call, `comment` turns it
// into one upserted PR comment ("PullUp would …"), `off` suppresses it. Without
// one, calls are planned exactly as before (the legacy shape above).
//
// PullUp *plans* these from its decisions; a ReviewActuator applies them.
// LoggingReviewActuator (the default) persists the exact call and sends
// nothing. The live GitHubReviewActuator (@pullup/github) sends it, and is only
// used when the operator turns delivery on (PULLUP_GITHUB_DELIVERY=live).
// Approve · Act additionally needs the repo's fast-path calibration gate to
// pass (actions/approval.ts); until then it is clamped to a comment.

import type { PullDecision } from "../cost/decision.js";
import type { PullRecord } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";
import type { ActionAuthority, AuthorityAction, AuthorityLevel } from "./authority.js";
import type { Finding } from "../findings/findings.js";
import type { SeverityAction } from "../config/severity.js";
import type { Authorization, PullUpTask } from "../authority/authorize.js";
import type { Permit } from "../authority/permit.js";
import { appendEvidence, outcomeEvidence, planEvidence, withoutPermit } from "../authority/evidence.js";
import type { ChecksConfig } from "../config/checks.js";
import type { FindingCommentRecord, HunkRecord } from "../schema/domain.js";
import type { InlineConfig } from "../config/inline.js";
import type { InlineComment, InlinePlan, InlineResolve } from "../findings/inline.js";
import { planInline } from "../findings/inline.js";
import type { CheckRunCall, CheckSpec } from "./check.js";
import { buildCheckSpec, checkRunCall } from "./check.js";

export type BotReviewAction = "approve" | "request_changes" | "defer_to_human";

export type GitHubReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

/** Marker PullUp writes into its own comment so it can find and edit it. */
export const DECISION_COMMENT_MARKER = "<!-- pullup:decision -->";

export interface GitHubReviewCall {
  /** Null when authority is `comment`/`off`, or for an `act`-level deferral. */
  readonly createReview: {
    readonly owner: string;
    readonly repo: string;
    readonly pull_number: number;
    readonly commit_id: string;
    readonly event: GitHubReviewEvent;
    readonly body: string;
  } | null;
  /**
   * The single PullUp comment on the PR, created once and edited in place
   * (found by `marker`): issues.createComment / issues.updateComment.
   */
  readonly upsertComment?: {
    readonly owner: string;
    readonly repo: string;
    readonly issue_number: number;
    readonly marker: string;
    readonly body: string;
  } | null;
  /** Present for defer_to_human when reviewers are configured (and authority allows). */
  readonly requestReviewers: {
    readonly owner: string;
    readonly repo: string;
    readonly pull_number: number;
    readonly reviewers: readonly string[];
  } | null;
  /** PullUp's check run on this head (checks.create, or checks.update when one exists). Absent when checks are off. */
  readonly checkRun?: CheckRunCall | null;
  /** New inline finding comments, as one COMMENT review on the head (pulls.createReview with comments). */
  readonly inlineReview?: {
    readonly owner: string;
    readonly repo: string;
    readonly pull_number: number;
    readonly commit_id: string;
    readonly event: "COMMENT";
    readonly body: string;
    readonly comments: readonly InlineComment[];
  } | null;
  /** PullUp's own finding threads to reply to and resolve (their finding is gone). */
  readonly resolveThreads?: readonly InlineResolve[];
}

export interface PlannedReviewAction {
  readonly repoId: string;
  readonly pullNumber: number;
  readonly headSha: string;
  readonly action: BotReviewAction;
  /** What produced it: the TCM recommendation, the (stubbed) Jev fast path, or a guardrail. */
  readonly source: "tcm" | "jev-fast-path" | "jev-escalate" | "jev-review-band" | "guardrail" | "finding";
  readonly recommendation: PullDecision["recommendation"];
  readonly band: string | null;
  readonly reason: string;
  readonly call: GitHubReviewCall;
  /** Authority applied to this action (absent in the legacy, authority-less plan). */
  readonly authority?: AuthorityLevel;
  /** Why the configured level was lowered (e.g. approve `act` while approval is stubbed). */
  readonly clamped?: string | null;
  /** Repo config version the plan was made under (null = file/defaults only). */
  readonly configVersion?: number | null;
  /** Active P0/P1/P2 findings behind this action (severity mode only). */
  readonly findings?: readonly Finding[];
  /** The agent's own review text (withReviewBody), reused if the action is lowered to a comment. */
  readonly rationale?: string;
  /** Set by governActions (authority/authorize.ts): the task this action belongs to. */
  readonly taskId?: string;
  readonly task?: PullUpTask;
  /** Whether PullUp may send this, decided separately from the decision itself. */
  readonly authorization?: Authorization;
  /** Signed, single-use, short-lived authority for a live send. Never persisted or shown to the model. */
  readonly permit?: Permit;
  /** Inputs for the check run (present when checks are enabled); `call.checkRun` is rebuilt from it. */
  readonly check?: CheckSpec;
  /** Inline finding comments to post / resolve (present when inline comments are enabled). */
  readonly inline?: InlinePlan;
}

/**
 *   logged     — recorded, not sent (the logging actuator)
 *   suppressed — authority `off`: recorded for the dashboard, nothing to send
 *   sent       — every call reached GitHub (live actuator)
 *   skipped    — live, but deliberately not sent (stale head, closed PR, already sent)
 *   denied     — PullUp had no authority to send it (stop switch, quarantine,
 *                bad or expired permit, config changed…), see `delivery.denied`
 *   failed     — live, and at least one call failed (see `delivery`)
 */
export type ReviewActionStatus = "logged" | "suppressed" | "sent" | "skipped" | "denied" | "failed";

/** What the live actuator did with one planned action. */
export interface ReviewDelivery {
  readonly at: string;
  /** GitHub ids of what was created/edited (for dedupe, edits and dismissal). */
  readonly reviewId?: number;
  readonly commentId?: number;
  /** PullUp's check run on this head. */
  readonly checkRunId?: number;
  /** Inline finding comments: what was posted, resolved, or found already resolved/deleted. */
  readonly inline?: {
    readonly reviewId?: number;
    readonly posted: readonly { readonly findingKey: string; readonly commentId: number }[];
    readonly resolved: readonly string[];
    readonly alreadyResolved: readonly string[];
    readonly missing: readonly string[];
  };
  readonly reviewersRequested?: readonly string[];
  /** The bot's own earlier REQUEST_CHANGES reviews dismissed by this delivery. */
  readonly dismissedReviewIds?: readonly number[];
  /** Why it was skipped, when status is `skipped`. */
  readonly skipped?: string;
  /** One entry per failed call, when status is `failed`. */
  readonly errors?: readonly string[];
  /** Why authority was refused, when status is `denied`. */
  readonly denied?: readonly string[];
  /** The credential used for the send (AUT-04). */
  readonly credential?: {
    readonly kind: "app" | "standing-token";
    readonly repositories: readonly string[];
    readonly permissions: Readonly<Record<string, string>>;
    readonly revoked: boolean;
    readonly revokeError?: string;
  };
  /** Post-send check against GitHub (VAL-04). */
  readonly verified?: { readonly ok: boolean; readonly detail: string };
}

export interface ReviewActionRecord extends PlannedReviewAction {
  readonly status: ReviewActionStatus;
  readonly loggedAt: string;
  /** Present once a live actuator handled the action. */
  readonly delivery?: ReviewDelivery;
}

export interface ReviewActuator {
  readonly kind: "log" | "github";
  apply(actions: readonly PlannedReviewAction[]): Promise<ReviewActionRecord[]>;
}

export interface PlanOptions {
  readonly repoId: string;
  readonly humanReviewers?: readonly string[];
  /** Per-action authority. Absent ⇒ the legacy plan (every action as a review call). */
  readonly authority?: ActionAuthority;
  /**
   * Whether approve may really `act`: needs live delivery *and* a passing
   * fast-path calibration gate for this repo (see `approvalGate`). Default
   * false: approve `act` is clamped to `comment`.
   */
  readonly approvalUnlocked?: boolean;
  /** Why approval is locked (shown as `clamped`); defaults to the generic reason. */
  readonly approvalLockedReason?: string;
  readonly configVersion?: number | null;
  /** Check run settings; only used with an authority (no checks in the legacy plan). */
  readonly checks?: ChecksConfig;
  /** This repo's stored hunks, to pin findings to diff lines in the check and inline comments. */
  readonly hunks?: readonly HunkRecord[];
  /** Inline finding comment settings; only used with an authority. */
  readonly inline?: InlineConfig;
  /** PullUp's stored inline comments for this repo (written by the live actuator). */
  readonly findingComments?: readonly FindingCommentRecord[];
  /** The question-set version, quoted in inline comments. */
  readonly questionSet?: string | null;
}

const BOT_FOOTER = "\n\n_— PullUp_";

export const AUTHORITY_KEY: Readonly<Record<BotReviewAction, AuthorityAction>> = {
  approve: "approve",
  request_changes: "requestChanges",
  defer_to_human: "requestHuman",
};

const WOULD: Readonly<Record<BotReviewAction, string>> = {
  approve: "approve",
  request_changes: "request changes on",
  defer_to_human: "ask a human to review",
};

/**
 * Maps open-PR decisions to bot review actions. Precedence mirrors asymmetric
 * authority: escalation/deferral beats approval, a guardrail blocker turns an
 * approval into a deferral, and a human's own CHANGES_REQUESTED is never
 * re-issued by the bot.
 */
export function planReviewActions(
  decisions: readonly PullDecision[],
  pulls: readonly Pick<PullRecord, "number" | "headSha">[],
  opts: PlanOptions,
): PlannedReviewAction[] {
  const [owner, repo] = opts.repoId.split("/") as [string, string];
  const shaByPull = new Map(pulls.map((p) => [p.number, p.headSha]));
  const reviewers = opts.humanReviewers ?? [];
  const out: PlannedReviewAction[] = [];

  for (const d of decisions) {
    if (d.state !== "open") continue;
    const headSha = shaByPull.get(d.pullNumber) ?? "";
    const band = d.risk?.band ?? null;
    const active = d.risk?.mode === "active";

    let action: BotReviewAction | null = null;
    let source: PlannedReviewAction["source"] = "tcm";
    let reason = d.reason;

    if (d.findings) {
      const chosen = severityChoice(d);
      if (!chosen) continue;
      ({ action, source, reason } = chosen);
    } else if (d.recommendation === "escalate") {
      action = "defer_to_human";
      const guardHits = d.guardrails?.requireHuman ?? [];
      source = guardHits.length > 0 && (d.risk?.escalateReasons.length ?? 0) === 0 ? "guardrail" : "jev-escalate";
      const reasons = [...guardHits, ...(d.risk?.escalateReasons ?? [])];
      reason = `Escalated: ${[...new Set(reasons)].join("; ")}`;
    } else if (active && band === "review-with-rationale" && d.recommendation !== "review-complete") {
      action = "defer_to_human";
      source = "jev-review-band";
      reason = `Needs a reviewer with rationale: ${(d.risk?.reviewReasons ?? []).join("; ")}`;
    } else if (d.recommendation === "request-changes" && d.lastReviewState !== "CHANGES_REQUESTED") {
      action = "request_changes";
    } else if (d.recommendation === "auto-approve") {
      action = "approve";
    } else if (active && d.risk?.fastPathEligible && d.recommendation === "keep-reviewing") {
      action = "approve";
      source = "jev-fast-path";
      reason = "Fast path: allowlisted low-risk change with all signals high-confidence.";
    }
    if (!action) continue;

    // Guardrails: the bot may not approve outside the configured envelope.
    const blockers = d.guardrails?.approveBlockers ?? [];
    if (action === "approve" && blockers.length > 0) {
      action = "defer_to_human";
      source = "guardrail";
      reason = `Would approve, but auto-approval is blocked: ${blockers.join("; ")}. Asking a human instead.`;
    }

    // Scoped rules can add reviewers for this PR.
    const prReviewers = [...new Set([...reviewers, ...(d.scope?.extraReviewers ?? [])])];
    const event: GitHubReviewEvent =
      action === "approve" ? "APPROVE" : action === "request_changes" ? "REQUEST_CHANGES" : "COMMENT";
    const legacyCall: GitHubReviewCall = {
      createReview: {
        owner,
        repo,
        pull_number: d.pullNumber,
        commit_id: headSha,
        event,
        body: `${reason}${findingsSection(activeFindings(d))}${BOT_FOOTER}`,
      },
      requestReviewers:
        action === "defer_to_human" && prReviewers.length > 0
          ? { owner, repo, pull_number: d.pullNumber, reviewers: prReviewers }
          : null,
    };
    const base = {
      repoId: opts.repoId,
      pullNumber: d.pullNumber,
      headSha,
      action,
      source,
      recommendation: d.recommendation,
      band,
      reason,
      ...(d.findings ? { findings: activeFindings(d) } : {}),
      ...(opts.authority && opts.checks?.enabled
        ? {
            check: buildCheckSpec({
              checks: opts.checks,
              findings: activeFindings(d),
              hunks: (opts.hunks ?? []).filter((h) => h.pullNumber === d.pullNumber),
              recommendation: d.recommendation,
              band,
              waitHours: d.waitHours,
              maxWaitHours: d.maxWaitHours,
              configVersion: opts.configVersion ?? null,
            }),
          }
        : {}),
      ...(opts.authority && opts.inline?.enabled
        ? {
            inline: planInline({
              config: opts.inline,
              findings: d.findings ?? [],
              hunks: (opts.hunks ?? []).filter((h) => h.pullNumber === d.pullNumber),
              existing: (opts.findingComments ?? []).filter((c) => c.pullNumber === d.pullNumber),
              headSha,
              signalsRan: d.risk !== undefined,
              questionSet: opts.questionSet ?? null,
            }),
          }
        : {}),
    };
    if (!opts.authority) {
      out.push({ ...base, call: legacyCall });
      continue;
    }
    out.push(applyAuthority({ ...base, call: legacyCall }, opts.authority, prReviewers, opts));
  }
  return out;
}

function activeFindings(d: PullDecision): Finding[] {
  return (d.findings ?? []).filter((f) => f.active);
}

/**
 * What the severity policy says to do about one finding. Signals can't request
 * changes unless opted in: `true` lets them, `"verified"` only with an accepted
 * confirmed verdict (verify/), and never on the injection tripwire itself.
 */
export function findingAction(d: Pick<PullDecision, "scope">, f: Finding): SeverityAction {
  const a = d.scope!.actions[f.level];
  if (a !== "request-changes" || f.source !== "signal") return a;
  const allowed = d.scope!.signalsCanRequestChanges;
  const verified = f.verdict?.accepted === true && f.verdict.verdict === "confirmed";
  if (f.kind === "injection" || allowed === false || (allowed === "verified" && !verified)) return "ask-human";
  return a;
}

const tag = (f: Finding) => `${f.level.toUpperCase()} ${f.title}`;

/**
 * Severity mode: the most severe finding decides. Request changes → ask a
 * human (incl. guardrail categories and escalations) → the cost model, whose
 * approvals still respect guardrail blockers.
 */
function severityChoice(
  d: PullDecision,
): { action: BotReviewAction; source: PlannedReviewAction["source"]; reason: string } | null {
  // A human is already deciding (approved, or requested changes): PullUp stays out of it.
  if (d.recommendation === "review-complete" || d.lastReviewState === "CHANGES_REQUESTED") return null;
  const findings = activeFindings(d);
  // An injection tripwire makes this PR's model signals untrustworthy: none of them may request changes.
  const injected = findings.some((f) => f.kind === "injection");
  const act = (f: Finding) => {
    const a = findingAction(d, f);
    return injected && f.source === "signal" && a === "request-changes" ? "ask-human" : a;
  };
  const requesting = findings.filter((f) => act(f) === "request-changes");
  const asking = findings.filter((f) => act(f) === "ask-human");
  const guardHits = d.guardrails?.requireHuman ?? [];
  const rules = d.scope?.appliedRules.length ? ` (rules: ${d.scope.appliedRules.map((r) => r.name).join(", ")})` : "";

  if (requesting.length > 0) {
    return { action: "request_changes", source: "finding", reason: `Changes requested: ${requesting.map(tag).join("; ")}${rules}.` };
  }
  if (guardHits.length > 0 || asking.length > 0 || d.recommendation === "escalate") {
    const reasons = [...guardHits, ...asking.map(tag), ...(d.recommendation === "escalate" ? (d.risk?.escalateReasons ?? []) : [])];
    return {
      action: "defer_to_human",
      source: guardHits.length > 0 ? "guardrail" : asking.length > 0 ? "finding" : "jev-escalate",
      reason: `Needs a human: ${[...new Set(reasons)].join("; ")}${rules}.`,
    };
  }
  const blockers = d.guardrails?.approveBlockers ?? [];
  const fastPath = d.risk?.mode === "active" && d.risk.fastPathEligible && d.recommendation === "keep-reviewing";
  if (d.recommendation === "auto-approve" || fastPath) {
    if (blockers.length > 0) {
      return {
        action: "defer_to_human",
        source: "guardrail",
        reason: `Would approve, but auto-approval is blocked: ${blockers.join("; ")}. Asking a human instead.`,
      };
    }
    return fastPath
      ? { action: "approve", source: "jev-fast-path", reason: "Fast path: allowlisted low-risk change with all signals high-confidence." }
      : { action: "approve", source: "tcm", reason: d.reason };
  }
  return null;
}

const CC_LABEL: Record<Finding["level"], string> = {
  p0: "issue (blocking)",
  p1: "issue",
  p2: "suggestion (non-blocking)",
};

/** The verifier's checked evidence for a finding, as a short suffix (empty when none is accepted). */
function verdictNote(f: Finding): string {
  const v = f.verdict;
  if (!v) return "";
  if (!(v.accepted && v.verdict === "confirmed")) return v.verdict === "not-confirmed" ? " — PullUp's evidence check did not confirm this; a human should still look." : "";
  const quotes = v.evidence.map((e) => `\`${e.path}:${e.line}\``).join(", ");
  return ` — confirmed against the code at ${quotes}${v.fix ? `. Suggested fix: ${v.fix}` : ""}`;
}

/** Findings grouped P0 / P1 / P2 with Conventional-Comments labels (empty when none). */
export function findingsSection(findings: readonly Finding[]): string {
  if (findings.length === 0) return "";
  const heads: Record<Finding["level"], string> = { p0: "P0 · blocking", p1: "P1 · important", p2: "P2 · minor" };
  const parts: string[] = [];
  for (const lvl of ["p0", "p1", "p2"] as const) {
    const fs = findings.filter((f) => f.level === lvl);
    if (fs.length === 0) continue;
    parts.push(`**${heads[lvl]}**\n${fs.map((f) => `- ${CC_LABEL[lvl]}: ${f.title} — ${f.detail} _(${f.source})_${verdictNote(f)}`).join("\n")}`);
  }
  return `\n\n${parts.join("\n\n")}`;
}

/** The body of PullUp's single, edited-in-place PR comment. */
export function decisionCommentBody(
  a: Pick<PlannedReviewAction, "action" | "reason" | "headSha"> & { readonly findings?: readonly Finding[] },
  level: AuthorityLevel,
): string {
  const sha = a.headSha ? ` at \`${a.headSha.slice(0, 7)}\`` : "";
  const head =
    level === "act"
      ? a.action === "defer_to_human"
        ? `**PullUp is asking for a human review**${sha}.`
        : `**PullUp ${a.action === "approve" ? "approved" : "requested changes on"} this PR**${sha}.`
      : `**PullUp would ${WOULD[a.action]} this PR**${sha}.`;
  const tail =
    level === "act"
      ? "_— PullUp_"
      : "_— PullUp, evaluation only: this comment is the whole action. It will be updated as the PR changes._";
  return `${DECISION_COMMENT_MARKER}\n${head}\n\n${a.reason}${findingsSection(a.findings ?? [])}\n\n${tail}`;
}

/**
 * The check run for a planned action at `level` (undefined when the action has
 * no check). The body is the decision comment's text without its marker.
 */
/** The inline-comment calls for a planned action at `level` (empty at `off`; undefined without inline comments). */
export function plannedInline(
  planned: Pick<PlannedReviewAction, "repoId" | "pullNumber" | "headSha" | "inline">,
  level: AuthorityLevel,
): Pick<GitHubReviewCall, "inlineReview" | "resolveThreads"> | undefined {
  if (!planned.inline) return undefined;
  if (level === "off") return { inlineReview: null, resolveThreads: [] };
  const [owner, repo] = planned.repoId.split("/") as [string, string];
  const post = planned.inline.post;
  return {
    inlineReview:
      post.length > 0
        ? {
            owner,
            repo,
            pull_number: planned.pullNumber,
            commit_id: planned.headSha,
            event: "COMMENT",
            body: `PullUp flagged ${post.length} place${post.length === 1 ? "" : "s"} at \`${planned.headSha.slice(0, 7)}\` for a closer look. These comments are information only; PullUp's decision is in its own comment.`,
            comments: post,
          }
        : null,
    resolveThreads: planned.inline.resolve,
  };
}

export function plannedCheckRun(
  planned: Pick<PlannedReviewAction, "repoId" | "headSha" | "action" | "reason" | "rationale" | "findings" | "check">,
  level: AuthorityLevel,
  clamped: string | null = null,
): CheckRunCall | null | undefined {
  if (!planned.check) return undefined;
  const body = decisionCommentBody({ ...planned, reason: planned.rationale ?? planned.reason }, level).replace(`${DECISION_COMMENT_MARKER}\n`, "");
  return checkRunCall({ ...planned, clamped }, planned.check, level, body);
}

/**
 * Shapes one planned action by the configured authority. Never changes the
 * decision, only what would be sent: `comment` and `off` can never emit an
 * APPROVE or REQUEST_CHANGES event.
 */
export function applyAuthority(
  planned: PlannedReviewAction,
  authority: ActionAuthority,
  reviewers: readonly string[],
  opts: Pick<PlanOptions, "approvalUnlocked" | "approvalLockedReason" | "configVersion">,
): PlannedReviewAction {
  const [owner, repo] = planned.repoId.split("/") as [string, string];
  const configured = authority[AUTHORITY_KEY[planned.action]];
  let level = configured;
  let clamped: string | null = null;
  if (planned.action === "approve" && level === "act" && !opts.approvalUnlocked) {
    level = "comment";
    clamped = `Approve is set to Act, but approval is locked: ${opts.approvalLockedReason ?? DEFAULT_LOCKED_REASON} — commenting instead.`;
  }
  const comment = (lvl: AuthorityLevel) => ({
    owner,
    repo,
    issue_number: planned.pullNumber,
    marker: DECISION_COMMENT_MARKER,
    body: decisionCommentBody(planned, lvl),
  });

  let call: GitHubReviewCall;
  if (level === "off") {
    call = { createReview: null, upsertComment: null, requestReviewers: null };
  } else if (level === "comment") {
    call = { createReview: null, upsertComment: comment("comment"), requestReviewers: null };
  } else if (planned.action === "defer_to_human") {
    call = {
      createReview: null,
      upsertComment: comment("act"),
      requestReviewers:
        reviewers.length > 0 ? { owner, repo, pull_number: planned.pullNumber, reviewers } : null,
    };
  } else {
    call = { ...planned.call, upsertComment: null, requestReviewers: null };
  }
  const checkRun = plannedCheckRun(planned, level, clamped);
  if (checkRun !== undefined) call = { ...call, checkRun };
  const inline = plannedInline(planned, level);
  if (inline) call = { ...call, ...inline };
  return { ...planned, call, authority: level, clamped, configVersion: opts.configVersion ?? null };
}

/**
 * Replaces the human-readable body of a planned action (e.g. with the agent's
 * rationale). Only text changes — the action, event, authority and reviewers
 * stay exactly as the engine planned them.
 */
export function withReviewBody(planned: PlannedReviewAction, body: string): PlannedReviewAction {
  const call = planned.call;
  const level = planned.authority ?? "act";
  const checkRun = call.checkRun ? plannedCheckRun({ ...planned, rationale: body }, level, planned.clamped ?? null) : undefined;
  return {
    ...planned,
    rationale: body,
    call: {
      ...call,
      createReview: call.createReview ? { ...call.createReview, body } : null,
      ...(call.upsertComment
        ? { upsertComment: { ...call.upsertComment, body: decisionCommentBody({ ...planned, reason: body }, level) } }
        : {}),
      ...(checkRun !== undefined ? { checkRun } : {}),
    },
  };
}

/** Default lock reason (approval stays stubbed until both conditions hold). */
export const DEFAULT_LOCKED_REASON =
  "approval is stubbed until live GitHub delivery is on and this repo's fast-path calibration gate passes";

/**
 * A record already delivered for this exact (pull, head, action), if any. The
 * logging actuator never overwrites it and the live actuator never re-sends it.
 */
export async function deliveredRecord(store: PullStore, a: PlannedReviewAction): Promise<ReviewActionRecord | null> {
  const prior = await store.listReviewActions(a.repoId, a.pullNumber);
  return prior.find((r) => r.status === "sent" && r.headSha === a.headSha && r.action === a.action) ?? null;
}

/** The logging actuator: persists what it would send, sends nothing. */
export class LoggingReviewActuator implements ReviewActuator {
  readonly kind = "log" as const;

  constructor(
    private readonly store: PullStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async apply(actions: readonly PlannedReviewAction[]): Promise<ReviewActionRecord[]> {
    const records: ReviewActionRecord[] = [];
    for (const a of actions) {
      // Don't clobber a delivered record (same key) with a "logged" one.
      const delivered = await deliveredRecord(this.store, a);
      if (delivered) {
        records.push(delivered);
        continue;
      }
      const at = this.now();
      for (const e of planEvidence(a, at)) await appendEvidence(this.store, e);
      const denied = a.authorization?.decision === "deny";
      const rec: ReviewActionRecord = {
        ...withoutPermit(a),
        status: denied ? "denied" : a.authority === "off" ? "suppressed" : "logged",
        loggedAt: at,
        ...(denied ? { delivery: { at, denied: a.authorization!.reasons } } : {}),
      };
      await this.store.recordReviewAction(rec);
      const outcome = outcomeEvidence(rec);
      if (outcome) await appendEvidence(this.store, outcome);
      records.push(rec);
    }
    return records;
  }
}
