// Thin wrapper: run the Jev risk layer (cached signals → policy → bands) for a
// repo's open PRs, or one PR, and return each decision with its planned bot
// review action and the flagged code the rationale must be grounded in.
// Logic lives in @pullup/core + @pullup/jev.

import { buildReport, planReviewActions } from "@pullup/core";
import { prepareJevRuntime } from "@pullup/jev";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getConfig, getStore } from "../lib/core.js";

export default defineTool({
  description:
    "Triage open PRs with the Jev risk layer: per-hunk typed risk signals, the deterministic path policy, and the resulting band (escalate / review-with-rationale / standard / fast-path) and recommendation, plus the bot review action PullUp would take (approve / request_changes / defer_to_human — logged only, never sent). Returns the flagged diff hunks so you can write a grounded rationale. Run ingest_repo first.",
  inputSchema: z.object({
    repoId: z.string().min(1).describe("owner/repo of the ingested repo"),
    pullNumber: z.number().int().optional().describe("Only this PR (default: all open PRs)"),
    mode: z
      .enum(["shadow", "active"])
      .optional()
      .describe("shadow = observe only; active = escalations take effect (default: config, else shadow)"),
  }),
  async execute({ repoId, pullNumber, mode }) {
    const store = await getStore();
    const cfg = getConfig();
    const effectiveMode = mode ?? (cfg.jev.mode === "off" ? "shadow" : cfg.jev.mode);
    const { runtime, run } = await prepareJevRuntime(store, repoId, cfg, {
      mode: effectiveMode,
      ...(pullNumber !== undefined ? { pullNumbers: [pullNumber] } : {}),
    });
    const report = await buildReport(store, repoId, cfg.priors, { jev: runtime ?? undefined });
    const pulls = await store.listPulls(repoId);
    const planned = planReviewActions(report.decisions, pulls, {
      repoId,
      humanReviewers: cfg.jev.humanReviewers,
    });
    const hunks = await store.listHunks(repoId, pullNumber);
    const open = report.decisions.filter(
      (d) => d.state === "open" && (pullNumber === undefined || d.pullNumber === pullNumber),
    );
    return {
      mode: effectiveMode,
      model: runtime?.modelId ?? null,
      notes: report.risk?.notes ?? [],
      counts: report.risk?.counts ?? null,
      signalRun: run ? { evaluated: run.evaluated, cached: run.cached, failed: run.failed, costUsd: run.costUsd } : null,
      pulls: open.map((d) => {
        const flaggedUnits = new Set((d.risk?.topSignals ?? []).map((t) => t.unitKey.split("#")[0]));
        const needsCode = d.risk?.needsRationale ?? false;
        return {
          pullNumber: d.pullNumber,
          title: d.title,
          recommendation: d.recommendation,
          reason: d.reason,
          waitHours: d.waitHours,
          maxWaitHours: d.maxWaitHours,
          risk: d.risk ?? null,
          plannedAction: planned.find((a) => a.pullNumber === d.pullNumber) ?? null,
          // The code behind the flags — the only basis for a rationale.
          flaggedHunks: needsCode
            ? hunks
                .filter((h) => h.pullNumber === d.pullNumber && (flaggedUnits.has(h.path) || flaggedUnits.size === 0))
                .slice(0, 4)
                .map((h) => ({ path: h.path, header: h.header, patch: h.patch.slice(0, 1_500) }))
            : [],
        };
      }),
    };
  },
});
