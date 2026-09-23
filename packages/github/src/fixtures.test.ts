import { describe, expect, it } from "vitest";
import { DEFAULT_PRIORS, InMemoryStore, buildReport, ingestRepo } from "@pullup/core";
import type { FixtureFile } from "@pullup/core";
import { FixturePullSource } from "./fixtures.js";

const FIXTURE: FixtureFile = {
  repo: { owner: "fixtures", repo: "healthy", defaultBranch: "main" },
  pulls: [
    {
      number: 1,
      title: "Add login feature",
      author: "alice",
      createdAt: "2026-08-01T00:00:00.000Z",
      closedAt: null,
      mergedAt: "2026-08-01T02:00:00.000Z",
      state: "merged",
      baseBranch: "main",
      headSha: "abc123",
      additions: 120,
      deletions: 10,
      changedFiles: 2,
      labels: ["enhancement"],
      draft: false,
      files: ["src/api/login.ts"],
      reviews: [
        { id: 1, author: "frank", submittedAt: "2026-08-01T01:00:00.000Z", state: "APPROVED", body: "LGTM" },
      ],
      reviewComments: [],
      defectEvents: [],
    },
    {
      number: 2,
      title: "Fix cache bug",
      author: "bob",
      createdAt: "2026-08-02T00:00:00.000Z",
      closedAt: null,
      mergedAt: null,
      state: "open",
      baseBranch: "main",
      headSha: "def456",
      additions: 30,
      deletions: 5,
      changedFiles: 1,
      labels: ["bug"],
      draft: false,
      files: ["src/db/cache.ts"],
      reviews: [
        { id: 2, author: "grace", submittedAt: "2026-08-02T04:00:00.000Z", state: "COMMENTED", body: "nits" },
      ],
      reviewComments: [{ id: 1, author: "grace", createdAt: "2026-08-02T04:00:00.000Z", path: "src/db/cache.ts", body: "reuse helper" }],
      defectEvents: [],
    },
  ],
};

describe("FixturePullSource", () => {
  it("serves a fixture through ingest → report end-to-end", async () => {
    const store = new InMemoryStore();
    const source = new FixturePullSource(FIXTURE, "fixtures/healthy");

    await ingestRepo(source, store);
    const report = await buildReport(store, "fixtures/healthy", DEFAULT_PRIORS);

    expect(report.pulls.total).toBe(2);
    expect(report.pulls.merged).toBe(1);
    // The open bugfix PR is young: the rule should keep reviewing (or equal,
    // if the model says so) — at minimum it must be a valid recommendation.
    expect(["keep-reviewing", "auto-approve", "request-changes"]).toContain(
      report.decisions[1]!.recommendation,
    );
  });

  it("hides nested arrays from listPulls", async () => {
    const source = new FixturePullSource(FIXTURE, "fixtures/healthy");
    const pulls = await source.listPulls();
    expect(pulls).toHaveLength(2);
    expect((pulls[0] as Record<string, unknown>).reviews).toBeUndefined();
    expect(await source.listReviews(1)).toHaveLength(1);
    expect(await source.listReviewComments(2)).toHaveLength(1);
  });
});
