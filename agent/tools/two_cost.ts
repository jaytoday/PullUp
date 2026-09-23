// Thin wrapper: expose the two-cost model parameters and per-change-type w*
// wait thresholds for an ingested repo. Logic lives in @pullup/core.

import { buildReport } from "@pullup/core";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPriors, getStore } from "../lib/core.js";

export default defineTool({
  description:
    "Return the two-cost model for an ingested repo: the waiting-cost rate r_v (congestion-inflated), expected defect cost C_defect = rework x escalation, review efficacy e_max, and the optimal max-wait threshold w* (hours) per change type where waiting cost crosses shipping-before-review cost.",
  inputSchema: z.object({
    repoId: z.string().min(1).describe("owner/repo of the ingested repo"),
  }),
  async execute({ repoId }) {
    const report = await buildReport(await getStore(), repoId, getPriors());
    const maxWaitByType: Record<string, number> = {};
    for (const d of report.decisions) {
      maxWaitByType[d.changeType] = Math.round(d.maxWaitHours * 10) / 10;
    }
    const p = report.params;
    return {
      waitingCostRatePerHour: p.valueDelayRatePerHour,
      defectCostHours: p.defectReworkHours * p.escalationMultiplier,
      efficacyMax: p.eMax,
      congestionQueueDepth: p.congestionQueueDepth,
      maxWaitByType,
      openPrCount: report.decisions.filter((d) => d.state === "open").length,
    };
  },
});
