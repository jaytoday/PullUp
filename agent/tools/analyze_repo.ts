// Thin wrapper: compile the full PullUp report for an ingested repo and return
// it as markdown. Logic lives in @pullup/core (buildReport + renderMarkdown).

import { buildReport, renderMarkdown } from "@pullup/core";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPriors, getStore } from "../lib/core.js";

export default defineTool({
  description:
    "Compile the full PullUp analytics report for an ingested repo (review latency, ship-risk, congestion, and per-open-PR max-wait decisions) and return it as markdown. Run ingest_repo first if the repo isn't ingested.",
  inputSchema: z.object({
    repoId: z.string().min(1).describe("owner/repo of the ingested repo"),
    configPath: z.string().optional().describe("Path to pullup.config.json (defaults to cwd)"),
  }),
  async execute({ repoId, configPath }) {
    const report = await buildReport(
      await getStore(),
      repoId,
      getPriors(configPath),
    );
    return { markdown: renderMarkdown(report) };
  },
});
