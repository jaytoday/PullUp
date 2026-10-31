// Walkthrough links: which changed files are linked, how, and the rule that a
// walkthrough never changes what PullUp decides or does.

import { describe, expect, it } from "vitest";
import { MODE_AUTHORITY } from "./authority.js";
import { decisionCommentBody, planReviewActions, withReviewBody } from "./review.js";
import { walkthroughLinks, walkthroughSection } from "./walkthroughs.js";
import { lowerAction } from "../authority/authorize.js";
import { DEFAULT_CHECKS } from "../config/checks.js";
import { configFileSchema, resolveConfigFile } from "../config/schema.js";
import { DEFAULT_WALKTHROUGHS } from "../config/walkthroughs.js";
import type { PullDecision } from "../cost/decision.js";

const REPO = "acme/api";
const SHA = "0123456789abcdef0123456789abcdef01234567";

const decision = (over: Partial<PullDecision> = {}): PullDecision =>
  ({
    pullNumber: 7,
    title: "t",
    changeType: "feature",
    area: "core",
    author: "dev",
    state: "open",
    waitHours: 1,
    maxWaitHours: 4,
    delayCost: 0,
    expectedDefectCost: 0,
    marginalDelayPerHour: 0,
    marginalReviewBenefitPerHour: 0,
    lastReviewState: null,
    recommendation: "escalate",
    reason: "Needs a human.",
    guardrails: { tier: "standard", lines: 10, files: 1, aiAuthored: false, requireHuman: ["auth path"], approveBlockers: [], notes: [] },
    ...over,
  }) as PullDecision;

const plan = (files: string[], d = decision(), opts: Partial<Parameters<typeof planReviewActions>[2]> = {}) =>
  planReviewActions([d], [{ number: 7, headSha: SHA, files }], { repoId: REPO, authority: MODE_AUTHORITY.evaluation, ...opts });

describe("walkthroughLinks", () => {
  it("links changed specs, pinned to the head commit, in path order", () => {
    const links = walkthroughLinks(REPO, SHA, ["src/a.ts", "specs/retry.md", "specs/sub/auth.mdx", "docs/x.md"]);
    expect(links.map((l) => l.path)).toEqual(["specs/retry.md", "specs/sub/auth.mdx"]);
    expect(links[0]).toEqual({
      path: "specs/retry.md",
      diffmapUrl: `https://diffmap.dev/acme/api/commit/${SHA}/specs/retry.md`,
      githubUrl: `https://github.com/acme/api/blob/${SHA}/specs/retry.md`,
    });
  });

  it("skips names that could inject Markdown, and non-Markdown files", () => {
    const files = ["specs/a b.md", "specs/x](http://evil).md", "specs/../x.md", "specs/`x`.md", "specs/x.txt", "specs/ok.md"];
    expect(walkthroughLinks(REPO, SHA, files).map((l) => l.path)).toEqual(["specs/ok.md"]);
  });

  it("is empty when off, without a real head commit, or for a bad repo id", () => {
    expect(walkthroughLinks(REPO, SHA, ["specs/a.md"], { ...DEFAULT_WALKTHROUGHS, enabled: false })).toEqual([]);
    expect(walkthroughLinks(REPO, "", ["specs/a.md"])).toEqual([]);
    expect(walkthroughLinks(REPO, "localsha", ["specs/a.md"])).toEqual([]);
    expect(walkthroughLinks("acme", SHA, ["specs/a.md"])).toEqual([]);
  });

  it("honours custom paths and maxLinks, and drops duplicates", () => {
    const cfg = { enabled: true, paths: ["docs/walkthroughs/**/*.md"], maxLinks: 2 };
    const files = ["docs/walkthroughs/c.md", "docs/walkthroughs/a.md", "docs/walkthroughs/b.md", "docs/walkthroughs/a.md", "specs/x.md"];
    expect(walkthroughLinks(REPO, SHA, files, cfg).map((l) => l.path)).toEqual(["docs/walkthroughs/a.md", "docs/walkthroughs/b.md"]);
  });

  it("renders one line per link, or nothing", () => {
    expect(walkthroughSection([])).toBe("");
    expect(walkthroughSection(walkthroughLinks(REPO, SHA, ["specs/a.md"]))).toBe(
      `\n\n**Walkthrough:** \`specs/a.md\` — [open in diffmap](https://diffmap.dev/acme/api/commit/${SHA}/specs/a.md) · [view on GitHub](https://github.com/acme/api/blob/${SHA}/specs/a.md)`,
    );
  });
});

describe("walkthroughs in planned actions", () => {
  it("adds the link to the decision comment and the check run", () => {
    const [a] = plan(["specs/a.md", "src/auth.ts"], decision(), { checks: { ...DEFAULT_CHECKS, enabled: true } });
    expect(a!.walkthroughs?.map((w) => w.path)).toEqual(["specs/a.md"]);
    expect(a!.call.upsertComment?.body).toContain("**Walkthrough:** `specs/a.md`");
    expect(a!.call.checkRun?.output.text).toContain("**Walkthrough:** `specs/a.md`");
  });

  it("keeps the link through the agent's rationale, a lowered level and an act-level review", () => {
    const [a] = plan(["specs/a.md"], decision(), { authority: MODE_AUTHORITY.full });
    expect(a!.call.upsertComment?.body).toContain("Walkthrough");
    expect(withReviewBody(a!, "Agent text.").call.upsertComment?.body).toMatch(/Agent text\.[\s\S]*Walkthrough/);
    expect(lowerAction(withReviewBody(a!, "Agent text."), "comment").call.upsertComment?.body).toContain("Walkthrough");
    const [rc] = plan(["specs/a.md"], decision({ recommendation: "request-changes", guardrails: undefined }), { authority: MODE_AUTHORITY.full });
    expect(rc!.call.createReview?.event).toBe("REQUEST_CHANGES");
    expect(withReviewBody(rc!, "Fix it.").call.createReview?.body).toMatch(/^Fix it\.[\s\S]*Walkthrough/);
  });

  it("never changes the action, source, reason or reviewers", () => {
    for (const d of [decision(), decision({ recommendation: "auto-approve", guardrails: undefined }), decision({ recommendation: "request-changes", guardrails: undefined })]) {
      const [without] = plan(["src/auth.ts"], d, { authority: MODE_AUTHORITY.full, humanReviewers: ["lead"] });
      const [withSpec] = plan(["src/auth.ts", "specs/a.md"], d, { authority: MODE_AUTHORITY.full, humanReviewers: ["lead"] });
      const pick = (x: typeof without) => ({ action: x!.action, source: x!.source, reason: x!.reason, authority: x!.authority, event: x!.call.createReview?.event, reviewers: x!.call.requestReviewers });
      expect(pick(withSpec)).toEqual(pick(without));
    }
  });

  it("is absent when no walkthrough changed, or when turned off", () => {
    const [none] = plan(["src/auth.ts"]);
    expect(none!.walkthroughs).toBeUndefined();
    expect(none!.call.upsertComment?.body).not.toContain("Walkthrough");
    const [off] = plan(["specs/a.md"], decision(), { walkthroughs: { ...DEFAULT_WALKTHROUGHS, enabled: false } });
    expect(off!.call.upsertComment?.body).not.toContain("Walkthrough");
    expect(decisionCommentBody({ action: "defer_to_human", reason: "r", headSha: SHA }, "comment")).not.toContain("Walkthrough");
  });
});

describe("walkthroughs config", () => {
  it("defaults on, accepts overrides and rejects unknown keys", () => {
    expect(resolveConfigFile({}).walkthroughs).toEqual(DEFAULT_WALKTHROUGHS);
    expect(resolveConfigFile({ walkthroughs: { maxLinks: 1 } }).walkthroughs.maxLinks).toBe(1);
    expect(configFileSchema.safeParse({ walkthroughs: { enabled: false, paths: ["docs/**/*.md"] } }).success).toBe(true);
    expect(configFileSchema.safeParse({ walkthroughs: { nope: 1 } }).success).toBe(false);
    expect(configFileSchema.safeParse({ walkthroughs: { maxLinks: 0 } }).success).toBe(false);
  });
});
