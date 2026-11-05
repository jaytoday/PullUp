import { ciRunSchema, type CiRun, parseDiff, type ReadFile, type RunContext } from "@pullup/sdk";

/** A run context for testing one extension on its own, as the host would build it. */
export function testContext<C>(config: C, run: Partial<CiRun> & { files?: ReadFile[] } = {}): RunContext<C> {
  const parsed = ciRunSchema.parse({ repo: "acme/shop", headSha: "h", jobs: [], ...run });
  return {
    config,
    repo: { fullName: parsed.repo },
    run: parsed,
    diff: parseDiff(parsed.diff),
    pull: parsed.pull,
    files: parsed.files,
    facts: { get: () => [] },
    shared: { requiredWorkflows: ["ci"], knownFlakyTests: [] },
    now: 0,
  };
}
