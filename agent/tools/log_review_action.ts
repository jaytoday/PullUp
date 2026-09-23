// Thin wrapper: record the bot review action for one PR with the rationale you
// wrote. The *action* (approve / request_changes / defer_to_human) is decided
// by the engine, never by the caller; approval authority is stubbed, so the
// GitHub call is logged and nothing is sent. Logic lives in @pullup/core.

import { LoggingReviewActuator, buildReport, planReviewActions } from "@pullup/core";
import { prepareJevRuntime } from "@pullup/jev";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getConfig, getStore } from "../lib/core.js";

export default defineTool({
  description:
    "Log PullUp's bot review action for one PR (the engine picks approve / request_changes / defer_to_human from triage; you supply the review body). Logged only — approval authority is stubbed and nothing is posted to GitHub. Use after triage_pull, with a rationale grounded in the flagged hunks.",
  inputSchema: z.object({
    repoId: z.string().min(1),
    pullNumber: z.number().int(),
    rationale: z.string().min(1).describe("Review body: why, grounded in the flagged code and signal names"),
    mode: z.enum(["shadow", "active"]).optional(),
  }),
  async execute({ repoId, pullNumber, rationale, mode }) {
    const store = await getStore();
    const cfg = getConfig();
    const { runtime } = await prepareJevRuntime(store, repoId, cfg, {
      mode: mode ?? (cfg.jev.mode === "off" ? "shadow" : cfg.jev.mode),
      pullNumbers: [pullNumber],
    });
    const report = await buildReport(store, repoId, cfg.priors, { jev: runtime ?? undefined });
    const planned = planReviewActions(
      report.decisions.filter((d) => d.pullNumber === pullNumber),
      await store.listPulls(repoId),
      { repoId, humanReviewers: cfg.jev.humanReviewers },
    );
    if (planned.length === 0) {
      return { logged: false, reason: "No bot review action for this PR (e.g. keep-reviewing or already decided by a human)." };
    }
    const withBody = planned.map((a) => ({
      ...a,
      call: { ...a.call, createReview: { ...a.call.createReview, body: rationale } },
    }));
    const [record] = await new LoggingReviewActuator(store).apply(withBody);
    return {
      logged: true,
      sent: false,
      action: record!.action,
      githubEvent: record!.call.createReview.event,
      requestReviewers: record!.call.requestReviewers?.reviewers ?? [],
      note: "Approval authority is stubbed: this GitHub review call was logged, not sent.",
    };
  },
});
