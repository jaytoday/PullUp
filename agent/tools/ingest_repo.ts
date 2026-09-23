// Thin wrapper: ingest a repo from a fixture JSON file (offline) into the
// SQLite store. Logic lives in @pullup/core (ingestRepo) — this tool only
// validates input and calls through.

import { ingestRepo } from "@pullup/core";
import { loadFixture } from "@pullup/github";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStore } from "../lib/core.js";

export default defineTool({
  description:
    "Ingest a repository from a fixture JSON file (offline mode) into the SQLite store. Idempotent: re-ingesting refreshes the same repo. Use for repos that are not reachable via the GitHub channel.",
  inputSchema: z.object({
    fixturePath: z.string().min(1).describe("Path to a PullUp fixture JSON file"),
    repoId: z.string().optional().describe("Optional repoId override (defaults to the fixture's owner/repo)"),
  }),
  async execute({ fixturePath, repoId }) {
    const source = loadFixture(fixturePath, repoId);
    const result = await ingestRepo(source, await getStore());
    return {
      repoId: result.repoId,
      pulls: result.pulls,
      reviews: result.reviews,
      comments: result.comments,
      defects: result.defects,
      mergedPulls: result.mergedPulls,
    };
  },
});
