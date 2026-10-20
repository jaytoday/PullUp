// Thin wrapper: apply PullUp's bot review action for one PR with the rationale
// you wrote. The *action* (approve / request_changes / defer_to_human) is
// decided by the engine, never by the caller. It is logged, or sent to GitHub
// when the operator set PULLUP_GITHUB_DELIVERY=live; Approve · Act additionally
// needs the repo's fast-path calibration gate. Every action is then authorized
// separately (repo profile, agent version, stop switch, permit) — you see the
// decision and its reasons, never the permit or the GitHub token. Logic lives
// in @pullup/core.

import {
  approvalGate,
  buildReport,
  calibrationPathFor,
  configReportOptions,
  ensureAgent,
  governPlan,
  loadCalibration,
  resolvePermitKey,
  planReviewActions,
  resolveDelivery,
  withReviewBody,
} from "@pullup/core";
import { createReviewActuator, credentialKind } from "@pullup/github";
import { existsSync } from "node:fs";
import { prepareJevRuntime } from "@pullup/jev";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getAgentIdentity, getRepoConfig, getStore } from "../lib/core.js";

export default defineTool({
  description:
    "Apply PullUp's bot review action for one PR (the engine picks approve / request_changes / defer_to_human from triage; you supply the review body). Logged only unless live GitHub delivery is on; the result's `sent` and `status` say what actually reached GitHub. Use after triage_pull, with a rationale grounded in the flagged hunks.",
  inputSchema: z.object({
    repoId: z.string().min(1),
    pullNumber: z.number().int(),
    rationale: z.string().min(1).describe("Review body: why, grounded in the flagged code and signal names"),
    mode: z.enum(["shadow", "active"]).optional(),
  }),
  async execute({ repoId, pullNumber, rationale, mode }) {
    const store = await getStore();
    const cfg = await getRepoConfig(repoId);
    const delivery = resolveDelivery();
    const { runtime } = await prepareJevRuntime(store, repoId, cfg, {
      mode: mode ?? (cfg.jev.mode === "off" ? "shadow" : cfg.jev.mode),
      pullNumbers: [pullNumber],
    });
    const calPath = calibrationPathFor(cfg.jev, repoId);
    const calibration = runtime?.calibration ?? (existsSync(calPath) ? loadCalibration(calPath) : null);
    const gate = approvalGate({ repoId, delivery, calibration });
    const report = await buildReport(store, repoId, cfg.priors, { jev: runtime ?? undefined, ...configReportOptions(cfg) });
    const planned = planReviewActions(
      report.decisions.filter((d) => d.pullNumber === pullNumber),
      await store.listPulls(repoId),
      {
        repoId,
        humanReviewers: cfg.jev.humanReviewers,
        authority: cfg.authority,
        configVersion: cfg.version,
        checks: cfg.checks,
        hunks: cfg.checks.enabled ? await store.listHunks(repoId, pullNumber) : [],
        approvalUnlocked: gate.unlocked,
        ...(gate.reason ? { approvalLockedReason: gate.reason } : {}),
      },
    );
    if (planned.length === 0) {
      return { logged: false, reason: "No bot review action for this PR (e.g. keep-reviewing or already decided by a human)." };
    }
    const withBody = planned.map((a) => withReviewBody(a, rationale));
    const agent = getAgentIdentity();
    const permitKey = resolvePermitKey();
    const now = new Date().toISOString();
    await ensureAgent(store, agent, now);
    const governed = await governPlan(store, withBody, {
      repoId,
      initiator: { kind: "agent", ref: null },
      agent,
      config: { version: cfg.version, hash: cfg.hash },
      risk: { questionSet: report.risk?.questionSetVersion ?? null, modelId: report.risk?.modelId ?? null },
      delivery,
      credential: credentialKind(),
      permitKey,
      sign: true,
      now,
    });
    const actuator = await createReviewActuator(store, repoId, {
      delivery,
      guard: { permitKey, agent, configHash: async (id) => (await getRepoConfig(id)).hash },
    });
    const [record] = await actuator.apply(governed);
    return {
      logged: true,
      delivery,
      sent: record!.status === "sent",
      action: record!.action,
      // Authority: act = the real review call · comment = one PullUp comment · off = suppressed.
      authority: record!.authority ?? "act",
      // logged · suppressed · sent · skipped (stale head / closed / already sent) · denied · failed
      status: record!.status,
      taskId: record!.taskId ?? null,
      // Whether PullUp was allowed to send it — decided separately from the decision. Never a permit or token.
      authorization: record!.authorization
        ? { decision: record!.authorization.decision, reasons: record!.authorization.reasons, profile: record!.authorization.profile }
        : null,
      denied: record!.delivery?.denied ?? [],
      clamped: record!.clamped ?? null,
      githubEvent: record!.call.createReview?.event ?? null,
      comment: record!.call.upsertComment ? "PullUp decision comment (edited in place)" : null,
      requestReviewers: record!.call.requestReviewers?.reviewers ?? [],
      ...(record!.delivery ? { deliveryDetail: record!.delivery } : {}),
      note:
        delivery === "live"
          ? "Live delivery: see status/deliveryDetail for what reached GitHub."
          : "Delivery is off (logging only): the call was logged, not sent to GitHub.",
    };
  },
});
