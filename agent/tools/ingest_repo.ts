// Thin wrapper: ingest a repo into the SQLite store, from a fixture JSON file
// (offline) or live from GitHub (App or token credentials). Logic lives in
// @pullup/core (ingestRepo) and @pullup/github — this tool only picks the source.

import { ingestRepo } from "@pullup/core";
import { OctokitPullSource, createRepoOctokit, loadFixture } from "@pullup/github";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getRepoConfig, getStore } from "../lib/core.js";

export default defineTool({
  description:
    "Ingest a repository into the SQLite store. With fixturePath: offline, from a fixture JSON file. Without: live from GitHub for repoId — pass pullNumbers to refresh just those PRs (e.g. the PR a webhook is about); the first live ingest of a repo always reads its full PR history. Idempotent.",
  inputSchema: z
    .object({
      fixturePath: z.string().min(1).optional().describe("Path to a PullUp fixture JSON file (offline mode)"),
      repoId: z.string().optional().describe("owner/repo — required for live ingest; overrides the fixture's repoId"),
      pullNumbers: z.array(z.number().int()).max(20).optional().describe("Live only: refresh just these PRs"),
    })
    .refine((x) => x.fixturePath || x.repoId, { message: "Pass fixturePath (offline) or repoId (live)." }),
  async execute({ fixturePath, repoId, pullNumbers }) {
    const store = await getStore();
    let source;
    let scope: "fixture" | "full" | "pulls" = "fixture";
    if (fixturePath) {
      source = loadFixture(fixturePath, repoId);
    } else {
      const known = await store.getRepository(repoId!);
      scope = known && pullNumbers?.length ? "pulls" : "full";
      source = new OctokitPullSource({
        repoId: repoId!,
        octokit: await createRepoOctokit(repoId!),
        ...(scope === "pulls" ? { pullNumbers } : {}),
      });
    }
    // Lint rules are read from the default branch when lint is on (free for a fixture, so always then).
    const { lint } = await getRepoConfig(source.repoId);
    const result = await ingestRepo(source, store, { lintRulesDir: fixturePath || lint.mode !== "off" ? lint.dir : null });
    return {
      scope,
      repoId: result.repoId,
      pulls: result.pulls,
      reviews: result.reviews,
      comments: result.comments,
      defects: result.defects,
      mergedPulls: result.mergedPulls,
    };
  },
});
