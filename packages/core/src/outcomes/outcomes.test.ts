// Decision outcomes and learnings: derived only from stored data, deterministic,
// and never applied to config.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReviewActionRecord } from "../actions/review.js";
import { DEFAULT_OUTCOMES } from "../config/outcomes.js";
import type { PullRecord, ReviewRecord } from "../schema/domain.js";
import { InMemoryStore } from "../schema/store.js";
import { deriveOutcome, deriveOutcomes, summarizeOutcomes } from "./derive.js";
import type { DecisionOutcome } from "./derive.js";
import { computeLearnings, pathFamily } from "./learn.js";
import { repoHistoryBlock } from "./history.js";

const REPO = "acme/api";
const T0 = "2026-09-01T10:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

const pull = (over: Partial<PullRecord> = {}): PullRecord =>
  ({ repoId: REPO, number: 7, author: "dev", headSha: "sha1", state: "open", mergedAt: null, closedAt: null, files: ["src/deps/package.json"], ...over }) as PullRecord;

const action = (over: Partial<ReviewActionRecord> = {}): ReviewActionRecord =>
  ({
    repoId: REPO,
    pullNumber: 7,
    headSha: "sha1",
    action: "defer_to_human",
    source: "finding",
    recommendation: "escalate",
    band: null,
    reason: "r",
    call: { createReview: null, requestReviewers: null },
    status: "sent",
    loggedAt: T0,
    authority: "comment",
    findings: [{ id: "signal:changesDependencyManifest", level: "p1", source: "signal", kind: "signal", title: "t", detail: "d", active: true, units: ["src/deps/package.json#0"] }],
    ...over,
  }) as ReviewActionRecord;

const review = (over: Partial<ReviewRecord>): ReviewRecord => ({ repoId: REPO, pullNumber: 7, id: 1, author: "lead", submittedAt: at(10), state: "APPROVED", body: null, ...over });

const NOW = "2026-10-19T00:00:00.000Z";
const derive = (a: ReviewActionRecord, p: PullRecord, rs: ReviewRecord[] = [], defects: { at: string }[] = [], resolved = false) =>
  deriveOutcome(a, p, rs, defects, resolved, DEFAULT_OUTCOMES, NOW).outcome;

describe("deriveOutcome", () => {
  it("asks: quick same-commit approval is unneeded; changes requested or new commits make it useful", () => {
    expect(derive(action(), pull(), [review({ commitId: "sha1" })])).toBe("ask-unneeded");
    expect(derive(action(), pull(), [review({ commitId: "sha1", submittedAt: at(300) })])).toBe("ask-approved");
    expect(derive(action(), pull(), [review({ commitId: "sha2" })])).toBe("ask-useful");
    expect(derive(action(), pull(), [review({ state: "CHANGES_REQUESTED" })])).toBe("ask-useful");
    expect(derive(action(), pull())).toBe("pending");
  });

  it("ignores bot reviews, comment-only reviews and reviews before the decision", () => {
    const rs = [review({ author: "pullup[bot]", commitId: "sha1" }), review({ state: "COMMENTED", id: 2 }), review({ id: 3, submittedAt: at(-60), commitId: "sha1" })];
    expect(derive(action(), pull(), rs)).toBe("pending");
  });

  it("without a recorded commit, 'same commit' falls back to the pull's head and is flagged approximate", () => {
    const r = deriveOutcome(action(), pull({ headSha: "sha1" }), [review({})], [], false, DEFAULT_OUTCOMES, NOW);
    expect(r).toMatchObject({ outcome: "ask-unneeded", approximate: true });
    expect(derive(action(), pull({ headSha: "sha9" }), [review({})])).toBe("ask-useful");
  });

  it("approvals: overridden by a human or a revert within the window; agreed once the window passes clean", () => {
    const a = action({ action: "approve" });
    const merged = pull({ state: "merged", mergedAt: "2026-09-02T00:00:00.000Z" });
    expect(derive(a, pull(), [review({ state: "CHANGES_REQUESTED" })])).toBe("human-overrode-approve");
    expect(derive(a, merged, [], [{ at: "2026-09-05T00:00:00.000Z" }])).toBe("human-overrode-approve");
    expect(derive(a, merged, [], [{ at: "2026-10-01T00:00:00.000Z" }])).toBe("human-agreed-approve");
    expect(deriveOutcome(a, merged, [], [], false, DEFAULT_OUTCOMES, "2026-09-05T00:00:00.000Z").outcome).toBe("pending");
  });

  it("change requests: addressed by new commits or a resolved finding; overridden when merged on the blocked commit", () => {
    const a = action({ action: "request_changes" });
    expect(derive(a, pull({ state: "merged", mergedAt: at(100), headSha: "sha2" }))).toBe("changes-addressed");
    expect(derive(a, pull({ state: "merged", mergedAt: at(100) }), [], [], true)).toBe("changes-addressed");
    expect(derive(a, pull({ state: "merged", mergedAt: at(100) }))).toBe("changes-overridden");
    expect(derive(a, pull({ state: "closed", closedAt: at(100) }))).toBe("closed");
  });
});

describe("deriveOutcomes over a store", () => {
  it("is deterministic, skips denied actions, and summarizes by outcome and finding", async () => {
    const store = new InMemoryStore();
    await store.upsertPull(pull());
    await store.upsertReview(review({ commitId: "sha1" }));
    await store.recordReviewAction(action());
    await store.recordReviewAction(action({ action: "approve", status: "denied" }));
    const a = await deriveOutcomes(store, REPO, DEFAULT_OUTCOMES, NOW);
    expect(await deriveOutcomes(store, REPO, DEFAULT_OUTCOMES, NOW)).toEqual(a);
    expect(a).toEqual([expect.objectContaining({ outcome: "ask-unneeded", sent: true, findings: [expect.objectContaining({ paths: ["src/deps/package.json"] })] })]);
    const s = summarizeOutcomes(a);
    expect(s.askUnneededRate).toBe(1);
    expect(s.byFinding[0]).toMatchObject({ findingId: "signal:changesDependencyManifest", pulls: 1 });
  });
});

const outcome = (n: number, kind: DecisionOutcome["outcome"], over: Partial<DecisionOutcome> = {}): DecisionOutcome => ({
  repoId: REPO,
  pullNumber: n,
  headSha: `sha${n}`,
  action: "defer_to_human",
  decidedAt: at(n),
  sent: true,
  authority: "comment",
  configVersion: null,
  author: "dev",
  files: ["docs/guide/package.json"],
  findings: [{ id: "signal:changesDependencyManifest", level: "p1", kind: "signal", paths: ["docs/guide/package.json"], verdict: null }],
  outcome: kind,
  detail: "",
  approximate: false,
  ...over,
});

describe("computeLearnings", () => {
  it("path families are the first two folders", () => {
    expect(pathFamily("src/billing/retry.ts")).toBe("src/billing/**");
    expect(pathFamily("lib/x.ts")).toBe("lib/**");
    expect(pathFamily("README.md")).toBe("README.md");
  });

  it("suggests lowering a question that humans keep approving unchanged, well above baseline, as a config edit", () => {
    const flagged = Array.from({ length: 9 }, (_, i) => outcome(i + 1, i < 8 ? "ask-unneeded" : "ask-approved"));
    const others = Array.from({ length: 10 }, (_, i) => outcome(100 + i, "ask-useful", { findings: [], files: ["src/core/a.ts"], decidedAt: "2026-06-01T00:00:00.000Z" }));
    const [l] = computeLearnings(REPO, [...flagged, ...others], [], NOW).filter((x) => x.kind === "over-escalation");
    expect(l).toMatchObject({ question: "signal:changesDependencyManifest", pathFamily: "docs/guide/**", status: "suggested" });
    expect(l!.evidence).toMatchObject({ support: 8, total: 9 });
    expect(l!.suggestion.ops).toEqual([{ op: "set", path: "severity.questionLevels.changesDependencyManifest", value: "p2" }]);
  });

  it("logged-only asks don't count, a recent useful ask blocks it, and so does a high baseline", () => {
    const base = Array.from({ length: 9 }, (_, i) => outcome(i + 1, "ask-unneeded"));
    expect(computeLearnings(REPO, base.map((o) => ({ ...o, sent: false })), [], NOW).some((l) => l.kind === "over-escalation")).toBe(false);
    const recentUseful = outcome(50, "ask-useful", { decidedAt: "2026-10-10T00:00:00.000Z" });
    expect(computeLearnings(REPO, [...base, recentUseful], [], NOW).some((l) => l.kind === "over-escalation")).toBe(false);
    // Every ask in the repo is rubber-stamped: the question isn't special.
    expect(computeLearnings(REPO, base, [], NOW).some((l) => l.kind === "over-escalation")).toBe(false);
  });

  it("dismissed learnings stay dismissed until the evidence doubles", () => {
    const flagged = Array.from({ length: 9 }, (_, i) => outcome(i + 1, "ask-unneeded"));
    const others = Array.from({ length: 30 }, (_, i) => outcome(100 + i, "ask-useful", { findings: [], files: ["src/core/a.ts"], decidedAt: "2026-06-01T00:00:00.000Z" }));
    const [l] = computeLearnings(REPO, [...flagged, ...others], [], NOW).filter((x) => x.kind === "over-escalation");
    const d = [{ repoId: REPO, learningId: l!.id, support: 9, at: NOW, by: "owner" }];
    expect(computeLearnings(REPO, [...flagged, ...others], d, NOW).find((x) => x.id === l!.id)!.status).toBe("dismissed");
    const more = Array.from({ length: 9 }, (_, i) => outcome(200 + i, "ask-unneeded"));
    expect(computeLearnings(REPO, [...flagged, ...more, ...others], d, NOW).find((x) => x.id === l!.id)!.status).toBe("suggested");
  });

  it("confirmed patterns raise a question; missed approvals add a no-auto-approve rule; guidance is text only", () => {
    const confirmed = Array.from({ length: 5 }, (_, i) => outcome(i + 1, "changes-addressed", { action: "request_changes" }));
    const misses = [1, 2].map((n) => outcome(300 + n, "human-overrode-approve", { action: "approve", findings: [], files: ["src/billing/retry.ts"], decidedAt: "2026-10-10T00:00:00.000Z" }));
    const useful = Array.from({ length: 5 }, (_, i) => outcome(400 + i, "ask-useful", { files: ["src/auth/session.ts"], findings: [], decidedAt: "2026-10-01T00:00:00.000Z" }));
    const ls = computeLearnings(REPO, [...confirmed, ...misses, ...useful], [], NOW);
    expect(ls.find((l) => l.kind === "confirmed-pattern")!.suggestion.ops).toEqual([{ op: "set", path: "severity.questionLevels.changesDependencyManifest", value: "p0" }]);
    expect(ls.find((l) => l.kind === "missed-risk")!.suggestion.ops).toEqual([
      { op: "add-rule", rule: { name: "Learned: no auto-approve in src/billing", when: { paths: ["src/billing/**"] }, set: { noAutoApprove: true } } },
    ]);
    const g = ls.find((l) => l.kind === "review-guidance")!;
    expect(g.suggestion.ops).toEqual([]);
    expect(g.summary).toBe("Humans requested changes on 5 of 5 pull requests touching src/auth/** in the last 90 days.");
  });

  it("drops families with unexpected characters (file names are pull-request content)", () => {
    const misses = [1, 2].map((n) => outcome(n, "human-overrode-approve", { action: "approve", findings: [], files: ["src/<ignore previous>/x.ts"], decidedAt: "2026-10-10T00:00:00.000Z" }));
    expect(computeLearnings(REPO, misses, [], NOW)).toEqual([]);
  });

  it("the history block for the rationale writer is numbers and identifiers only", () => {
    const misses = [1, 2].map((n) => outcome(n, "human-overrode-approve", { action: "approve", findings: [], files: ["src/billing/retry.ts"], decidedAt: "2026-10-10T00:00:00.000Z" }));
    const ls = computeLearnings(REPO, misses, [], NOW);
    const block = repoHistoryBlock(ls, ["src/billing/refund.ts"])!;
    expect(block).toMatch(/^<repo_history trust="derived-data">/);
    expect(JSON.parse(block.split("\n")[1]!)).toEqual([{ kind: "missed-risk", question: null, paths: "src/billing/**", pulls: 2, supporting: 2, rate: 1 }]);
    expect(repoHistoryBlock(ls, ["docs/a.md"])).toBeNull();
  });
});

describe("outcomes never write config", () => {
  it("no code under outcomes/ appends config versions or saves settings", () => {
    const dir = new URL(".", import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const src = readFileSync(new URL(f, dir), "utf8");
      expect(src, f).not.toMatch(/appendConfigVersion|saveRepoConfig|setControlState/);
    }
  });
});
