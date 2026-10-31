// The authorizer: decides whether the AI may *carry out* what it recommended,
// separately from the recommendation itself, as an explicit allow / lower /
// deny with reasons. It can only lower what is sent, never raise it.
//
//   recommend (decide.ts) → authorize (here) → permit → carry out → evidence
//
// Pure and offline. A missing input denies (fail closed).

export type CaseAction = "approve" | "refer" | "adverse";

/**
 * What may actually be done:
 * - `none`: record the recommendation only.
 * - `route-to-person`: put the case in a person's queue, with the
 *   recommendation and reasons attached.
 * - `act`: carry out the favorable action (pay, bind, quote) automatically.
 */
export type Effect = "none" | "route-to-person" | "act";

export const EFFECT_RANK: Readonly<Record<Effect, number>> = { none: 0, "route-to-person": 1, act: 2 };

/**
 * How much a program (a line of business, an insurer's delegated program, a
 * repository) is enrolled for:
 * - `observe`: recommendations are recorded, nothing is sent.
 * - `refer-only`: may route to a person, never acts.
 * - `act-within-limits`: may act on favorable cases inside the limits.
 */
export type CapabilityProfile = "observe" | "refer-only" | "act-within-limits";

export const PROFILE_CEILING: Readonly<Record<CapabilityProfile, Effect>> = {
  observe: "none",
  "refer-only": "route-to-person",
  "act-within-limits": "act",
};

export type AgentStatus = "pending" | "approved" | "quarantined";

export interface AuthorityLimits {
  /** Largest amount the AI may act on alone (claim payment, total insured value, premium). */
  readonly maxActAmount: number;
}

export interface AuthorityContext {
  readonly profile: CapabilityProfile;
  readonly limits: AuthorityLimits;
  /** Unknown means the version could not be determined (→ deny). */
  readonly agentStatus: AgentStatus | "unknown";
  /** Null when the stop switch could not be read (→ deny). */
  readonly stop: { readonly stopped: boolean; readonly reason: string } | null;
  /** The calibration artifact's automatic-approval gate. */
  readonly autoGatePassed: boolean;
  /** The fairness gate; null when no fairness report exists (→ no acting). */
  readonly fairnessGatePassed: boolean | null;
  readonly delivery: "log" | "live";
  /** Whether a permit key is configured (needed for live sends). */
  readonly permitKey: boolean;
}

export type AuthorizationDecision = "allow" | "lowered" | "deny";

export interface Authorization {
  readonly decision: AuthorizationDecision;
  readonly requested: Effect;
  readonly effective: Effect;
  readonly reasons: readonly string[];
}

export function requestedEffect(action: CaseAction): Effect {
  return action === "approve" ? "act" : "route-to-person";
}

const lower = (a: Effect, b: Effect): Effect => (EFFECT_RANK[a] <= EFFECT_RANK[b] ? a : b);

export function authorize(
  task: { readonly action: CaseAction; readonly amount: number },
  ctx: AuthorityContext,
): Authorization {
  const requested = requestedEffect(task.action);

  const denied: string[] = [];
  if (ctx.stop === null) denied.push("The stop switch could not be read.");
  else if (ctx.stop.stopped) denied.push(`Automated actions are stopped${ctx.stop.reason ? `: ${ctx.stop.reason}` : ""}.`);
  if (ctx.agentStatus === "quarantined") denied.push("This agent version is quarantined.");
  if (ctx.agentStatus === "unknown") denied.push("This agent's version could not be determined.");
  if (ctx.delivery === "live" && !ctx.permitKey) denied.push("No permit key is configured, so no permit can be issued.");
  if (!Number.isFinite(task.amount) || task.amount < 0) denied.push("The case amount is missing or invalid.");
  if (denied.length > 0) return { decision: "deny", requested, effective: "none", reasons: denied };

  const reasons: string[] = [];
  let effective = requested;
  const cap = (to: Effect, reason: string) => {
    if (EFFECT_RANK[to] < EFFECT_RANK[effective]) {
      effective = lower(effective, to);
      reasons.push(reason);
    }
  };

  cap(PROFILE_CEILING[ctx.profile], `This program is enrolled as "${ctx.profile}", which allows at most: ${PROFILE_CEILING[ctx.profile]}.`);
  if (task.action === "adverse") cap("route-to-person", "Adverse decisions (deny, decline, reduce) always go to a person.");
  if (!ctx.autoGatePassed) cap("route-to-person", "The risk model has not passed its automatic-approval gate.");
  if (ctx.fairnessGatePassed !== true) {
    cap("route-to-person", ctx.fairnessGatePassed === null ? "No fairness report exists for this model." : "The model failed its fairness gate.");
  }
  if (task.amount > ctx.limits.maxActAmount) cap("route-to-person", `The amount ${task.amount} is above the automatic limit of ${ctx.limits.maxActAmount}.`);
  if (ctx.agentStatus === "pending") cap("route-to-person", "This agent version has not been approved yet.");

  const decision: AuthorizationDecision = effective === requested ? "allow" : "lowered";
  if (decision === "allow") reasons.push(`Allowed: ${effective}.`);
  return { decision, requested, effective, reasons };
}
