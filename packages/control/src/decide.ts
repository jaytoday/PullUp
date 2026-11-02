// One case, end to end:
//
//   risk (calibrated model + raise-only signals)
//   → recommendation (approve / refer / adverse), by the two-cost rule
//   → authorization (what may actually be done)
//   → permit (live only)
//   → evidence rows
//
// `carryOut` is the only place an action happens: it re-checks the permit
// against the exact call immediately before calling the sender, and records
// what happened.

import { randomBytes } from "node:crypto";
import type { Authorization, AuthorityContext, CaseAction, Effect } from "./authority.js";
import { authorize } from "./authority.js";
import type { CalibrationArtifact } from "./calibration.js";
import { scoreCase } from "./calibration.js";
import { round } from "./canonical.js";
import type { CaseCosts, CostComparison } from "./cost.js";
import { compareCosts } from "./cost.js";
import type { EvidenceRow, EvidenceStore } from "./evidence.js";
import { appendEvidence } from "./evidence.js";
import type { NonceLedger, Permit } from "./permit.js";
import { callHash, checkPermit, issuePermit } from "./permit.js";
import type { Reason, ReasonTable } from "./reasons.js";
import { topReasons } from "./reasons.js";
import type { RiskSignal } from "./risk.js";
import { combineRisk } from "./risk.js";

export interface CaseInput {
  readonly id: string;
  /** Program, line of business or other unit the limits and evidence chain belong to. */
  readonly scope: string;
  readonly amount: number;
  readonly features: Readonly<Record<string, number>>;
  readonly signals?: readonly RiskSignal[];
  readonly costs: CaseCosts;
  /**
   * An upstream check found grounds for an adverse decision (for example a
   * policy exclusion found by a document review). The AI never sends one; it
   * goes to a person with these reasons.
   */
  readonly adverse?: { readonly reasons: readonly string[] };
}

export interface DecideContext {
  /** Null when no model is calibrated yet (→ every case is referred). */
  readonly model: CalibrationArtifact | null;
  readonly authority: Omit<AuthorityContext, "autoGatePassed">;
  readonly agent: { readonly id: string; readonly version: string };
  readonly configHash: string;
  readonly permitKey: string | null;
  readonly reasonTable: ReasonTable;
  /** Typical feature values, the baseline for reasons. */
  readonly typical: Readonly<Record<string, number>>;
  readonly now: string;
}

/** The call a sender receives — also what the permit's call hash covers. */
export interface CaseCall {
  readonly caseId: string;
  readonly effect: Exclude<Effect, "none">;
  readonly action: CaseAction;
  readonly amount: number;
  readonly reasons: readonly string[];
}

export interface CaseDecision {
  readonly taskId: string;
  readonly caseId: string;
  readonly scope: string;
  readonly risk: number | null;
  readonly cost: CostComparison | null;
  readonly recommendation: CaseAction;
  readonly reasons: readonly Reason[];
  readonly authorization: Authorization;
  readonly call: CaseCall | null;
  readonly permit: Permit | null;
}

export function newTaskId(now: string): string {
  return `t_${Date.parse(now).toString(36).padStart(9, "0")}${randomBytes(5).toString("hex")}`;
}

export function decideCase(input: CaseInput, ctx: DecideContext): CaseDecision {
  const taskId = newTaskId(ctx.now);
  const signals = input.signals ?? [];
  const modelUsable = ctx.model !== null && ctx.model.gate.passed;
  const risk = modelUsable ? round(combineRisk(scoreCase(ctx.model!, input.features), signals), 6) : null;
  const cost = risk === null ? null : compareCosts(risk, input.costs);

  let recommendation: CaseAction;
  let reasons: Reason[];
  if (input.adverse) {
    recommendation = "adverse";
    reasons = input.adverse.reasons.map((text, i) => ({ feature: `adverse:${i}`, text, push: 0 }));
  } else if (risk === null || cost === null) {
    recommendation = "refer";
    reasons = [{ feature: "model", text: "No calibrated risk model is available for this program.", push: 0 }];
  } else {
    recommendation = cost.cheaper === "act" ? "approve" : "refer";
    reasons = recommendation === "refer" ? topReasons(ctx.model!, input.features, ctx.typical, ctx.reasonTable, { signals }) : [];
  }

  const authorization = authorize(
    { action: recommendation, amount: input.amount },
    { ...ctx.authority, autoGatePassed: modelUsable && ctx.model!.autoGate.passed },
  );

  const call: CaseCall | null =
    authorization.effective === "none"
      ? null
      : { caseId: input.id, effect: authorization.effective, action: recommendation, amount: input.amount, reasons: reasons.map((r) => r.text) };

  const permit =
    call && ctx.authority.delivery === "live" && ctx.permitKey
      ? issuePermit(
          {
            taskId,
            scope: input.scope,
            caseId: input.id,
            action: recommendation,
            effect: call.effect,
            amount: input.amount,
            configHash: ctx.configHash,
            agentVersion: ctx.agent.version,
            callHash: callHash(call),
          },
          ctx.permitKey,
          { now: ctx.now },
        )
      : null;

  return { taskId, caseId: input.id, scope: input.scope, risk, cost, recommendation, reasons, authorization, call, permit };
}

/** Records the decision, authorization and permit (signature left out). */
export async function recordDecision(store: EvidenceStore, d: CaseDecision, at: string): Promise<EvidenceRow[]> {
  const base = { scope: d.scope, taskId: d.taskId, at };
  const rows = [
    await appendEvidence(store, { ...base, kind: "decision", payload: { caseId: d.caseId, risk: d.risk, cost: d.cost, recommendation: d.recommendation, reasons: d.reasons } }),
    await appendEvidence(store, { ...base, kind: "authorization", payload: d.authorization }),
  ];
  if (d.permit) rows.push(await appendEvidence(store, { ...base, kind: "permit-issued", payload: d.permit.claims }));
  return rows;
}

export type Sender = (call: CaseCall) => Promise<{ readonly ref: string }>;

/**
 * Carries out a decision's call. In log delivery nothing is sent. In live
 * delivery the permit is checked against the exact call immediately before
 * sending; any failure blocks the send. Either way the result is recorded.
 */
export async function carryOut(
  d: CaseDecision,
  opts: {
    readonly delivery: "log" | "live";
    readonly key: string | null;
    readonly ledger: NonceLedger;
    readonly store: EvidenceStore;
    readonly send: Sender;
    readonly now: string;
  },
): Promise<{ readonly status: "nothing-to-send" | "logged" | "sent" | "blocked"; readonly detail: string }> {
  const base = { scope: d.scope, taskId: d.taskId, at: opts.now };
  if (!d.call) return { status: "nothing-to-send", detail: "The authorization allows no action." };
  if (opts.delivery === "log") return { status: "logged", detail: "Log delivery: nothing was sent." };
  const problem = await checkPermit(d.permit ?? undefined, d.call, { key: opts.key, now: opts.now, ledger: opts.ledger });
  if (problem) {
    await appendEvidence(opts.store, { ...base, kind: "blocked", payload: { reason: problem } });
    return { status: "blocked", detail: problem };
  }
  const { ref } = await opts.send(d.call);
  await appendEvidence(opts.store, { ...base, kind: "sent", payload: { effect: d.call.effect, ref } });
  return { status: "sent", detail: ref };
}
