// Bot review actions. A code-review bot acts on a pull through the GitHub
// pull-request review API:
//
//   approve          → pulls.createReview { event: "APPROVE" }
//   request_changes  → pulls.createReview { event: "REQUEST_CHANGES" }
//   defer_to_human   → pulls.createReview { event: "COMMENT" } + pulls.requestReviewers
//
// PullUp *plans* these from its decisions; a ReviewActuator applies them. The
// only actuator in this build is LoggingReviewActuator: it persists the exact
// call it would make and sends nothing. Approval authority is deliberately
// stubbed — a live GitHub actuator is a later, explicit enablement.

import type { PullDecision } from "../cost/decision.js";
import type { PullRecord } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";

export type BotReviewAction = "approve" | "request_changes" | "defer_to_human";

export type GitHubReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface GitHubReviewCall {
  readonly createReview: {
    readonly owner: string;
    readonly repo: string;
    readonly pull_number: number;
    readonly commit_id: string;
    readonly event: GitHubReviewEvent;
    readonly body: string;
  };
  /** Present for defer_to_human when reviewers are configured. */
  readonly requestReviewers: {
    readonly owner: string;
    readonly repo: string;
    readonly pull_number: number;
    readonly reviewers: readonly string[];
  } | null;
}

export interface PlannedReviewAction {
  readonly repoId: string;
  readonly pullNumber: number;
  readonly headSha: string;
  readonly action: BotReviewAction;
  /** What produced it: the TCM recommendation, or the (stubbed) Jev fast path. */
  readonly source: "tcm" | "jev-fast-path" | "jev-escalate" | "jev-review-band";
  readonly recommendation: PullDecision["recommendation"];
  readonly band: string | null;
  readonly reason: string;
  readonly call: GitHubReviewCall;
}

export interface ReviewActionRecord extends PlannedReviewAction {
  readonly status: "logged";
  readonly loggedAt: string;
}

export interface ReviewActuator {
  readonly kind: "log";
  apply(actions: readonly PlannedReviewAction[]): Promise<ReviewActionRecord[]>;
}

export interface PlanOptions {
  readonly repoId: string;
  readonly humanReviewers?: readonly string[];
}

const BOT_FOOTER = "\n\n_— PullUp (recommendation only; approval authority is stubbed and logged)_";

/**
 * Maps open-PR decisions to bot review actions. Precedence mirrors asymmetric
 * authority: escalation/deferral beats approval, and a human's own
 * CHANGES_REQUESTED is never re-issued by the bot.
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

    if (d.recommendation === "escalate") {
      action = "defer_to_human";
      source = "jev-escalate";
      reason = `Escalated: ${(d.risk?.escalateReasons ?? []).join("; ")}`;
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

    const event: GitHubReviewEvent =
      action === "approve" ? "APPROVE" : action === "request_changes" ? "REQUEST_CHANGES" : "COMMENT";
    out.push({
      repoId: opts.repoId,
      pullNumber: d.pullNumber,
      headSha,
      action,
      source,
      recommendation: d.recommendation,
      band,
      reason,
      call: {
        createReview: {
          owner,
          repo,
          pull_number: d.pullNumber,
          commit_id: headSha,
          event,
          body: `${reason}${BOT_FOOTER}`,
        },
        requestReviewers:
          action === "defer_to_human" && reviewers.length > 0
            ? { owner, repo, pull_number: d.pullNumber, reviewers }
            : null,
      },
    });
  }
  return out;
}

/** The stub actuator: persists what it would send, sends nothing. */
export class LoggingReviewActuator implements ReviewActuator {
  readonly kind = "log" as const;

  constructor(
    private readonly store: PullStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async apply(actions: readonly PlannedReviewAction[]): Promise<ReviewActionRecord[]> {
    const records: ReviewActionRecord[] = [];
    for (const a of actions) {
      const rec: ReviewActionRecord = { ...a, status: "logged", loggedAt: this.now() };
      await this.store.recordReviewAction(rec);
      records.push(rec);
    }
    return records;
  }
}
