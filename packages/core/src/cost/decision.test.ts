import { describe, expect, it } from "vitest";
import { DEFAULT_PRIORS } from "../config/config.js";
import { FixtureSource, generateRepo } from "../testing/generate.js";
import { InMemoryStore } from "../schema/store.js";
import { ingestRepo } from "../ingest/pipeline.js";
import { runAnalytics } from "../analytics/run.js";
import { assembleParams } from "./params.js";
import { decideOne, decideForRepo, summarizeDecisions } from "./decision.js";
import type { CostParams } from "./params.js";
import type { PullRecord, ReviewRecord } from "../schema/domain.js";
import { addHours } from "../schema/domain.js";

const NOW = "2026-08-15T00:00:00.000Z";

async function paramsFor(seed = 9, n = 100): Promise<CostParams> {
  const store = new InMemoryStore();
  await ingestRepo(new FixtureSource(generateRepo({ seed, n })), store);
  const report = await runAnalytics(store, "fixtures/healthy", DEFAULT_PRIORS);
  return assembleParams(report, DEFAULT_PRIORS);
}

function makePull(overrides: Partial<PullRecord> & Pick<PullRecord, "number">): PullRecord {
  return {
    repoId: "fixtures/healthy",
    title: `PR #${overrides.number}`,
    author: "alice",
    createdAt: addHours(NOW, -48),
    closedAt: null,
    mergedAt: null,
    state: "open",
    baseBranch: "main",
    headSha: "abc",
    additions: 100,
    deletions: 20,
    changedFiles: 3,
    labels: [],
    draft: false,
    files: ["src/api/x.ts"],
    changeType: "feature",
    area: "api",
    sizeBucket: "s",
    defectProxy: null,
    firstReviewRequestedAt: null,
    firstHumanReviewAt: null,
    reviewCompletedAt: null,
    reviewHours: null,
    totalReviewHours: null,
    reviewOutcome: "none",
    reviewCount: 0,
    commentCount: 0,
    ...overrides,
  };
}

function makeReview(overrides: Partial<ReviewRecord> & Pick<ReviewRecord, "pullNumber">): ReviewRecord {
  return {
    repoId: "fixtures/healthy",
    id: 1,
    author: "frank",
    submittedAt: NOW,
    state: "APPROVED",
    body: "ok",
    ...overrides,
  };
}

describe("decideOne", () => {
  it("auto-approves an open PR that has waited past its max-wait", async () => {
    const params = await paramsFor(9);
    const d = decideOne(
      makePull({ number: 1, createdAt: addHours(NOW, -48) }),
      [makeReview({ pullNumber: 1, state: "COMMENTED", submittedAt: addHours(NOW, -30) })],
      params,
      NOW,
    );
    expect(d.recommendation).toBe("auto-approve");
    expect(d.waitHours).toBeGreaterThanOrEqual(d.maxWaitHours);
  });

  it("keeps reviewing a young, high-value PR", async () => {
    const params = await paramsFor(9);
    const d = decideOne(
      makePull({ number: 2, createdAt: addHours(NOW, -2) }),
      [],
      params,
      NOW,
    );
    expect(d.recommendation).toBe("keep-reviewing");
  });

  it("request-changes when the last human review was blocking", async () => {
    const params = await paramsFor(9);
    const d = decideOne(
      makePull({ number: 3, createdAt: addHours(NOW, -30 * 24) }),
      [makeReview({ pullNumber: 3, state: "CHANGES_REQUESTED", submittedAt: addHours(NOW, -1) })],
      params,
      NOW,
    );
    expect(d.recommendation).toBe("request-changes");
  });

  it("review-complete for already-merged and already-approved PRs", async () => {
    const params = await paramsFor(9);
    const merged = decideOne(makePull({ number: 4, state: "merged", mergedAt: addHours(NOW, -10) }), [], params, NOW);
    expect(merged.recommendation).toBe("review-complete");

    const approved = decideOne(
      makePull({ number: 5, createdAt: addHours(NOW, -2) }),
      [makeReview({ pullNumber: 5, state: "APPROVED" })],
      params,
      NOW,
    );
    expect(approved.recommendation).toBe("review-complete");
  });
});

describe("decideForRepo", () => {
  it("decides every pull and summarizes", async () => {
    const store = new InMemoryStore();
    await ingestRepo(new FixtureSource(generateRepo({ seed: 21, n: 50 })), store);
    const report = await runAnalytics(store, "fixtures/healthy", DEFAULT_PRIORS);
    const params = assembleParams(report, DEFAULT_PRIORS);

    const decisions = await decideForRepo(store, "fixtures/healthy", params, NOW);
    expect(decisions.length).toBe(50);
    const counts = summarizeDecisions(decisions);
    const open = decisions.filter((d) => d.state === "open").length;
    expect(counts.reviewComplete + counts.autoApprove + counts.keepReviewing + counts.requestChanges)
      .toBe(50);
    expect(open).toBeGreaterThan(0);
  });
});
