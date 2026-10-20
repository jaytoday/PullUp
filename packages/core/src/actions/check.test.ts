// The PullUp check run: conclusion mapping, annotations, and the rule that a
// check never makes approval easier than the review action itself.

import { describe, expect, it } from "vitest";
import type { ActionAuthority } from "./authority.js";
import { MODE_AUTHORITY } from "./authority.js";
import { CHECK_ANNOTATION_LIMIT, checkAnnotations, checkConclusion } from "./check.js";
import { planReviewActions, withReviewBody } from "./review.js";
import { lowerAction } from "../authority/authorize.js";
import { DEFAULT_CHECKS } from "../config/checks.js";
import { DEFAULT_SEVERITY } from "../config/severity.js";
import type { PullDecision } from "../cost/decision.js";
import type { Finding } from "../findings/findings.js";
import { hunkNewRange, locateFinding, parseUnitKey } from "../findings/locations.js";
import type { HunkRecord } from "../schema/domain.js";

const REPO = "acme/api";

const hunk = (path: string, index: number, header: string, over: Partial<HunkRecord> = {}): HunkRecord => ({
  repoId: REPO,
  pullNumber: 7,
  path,
  index,
  header,
  patch: "+x",
  noPatch: false,
  contentHash: `${path}#${index}`,
  ...over,
});

const signal = (id: string, level: Finding["level"], units: string[]): Finding => ({
  id,
  level,
  source: "signal",
  kind: "signal",
  title: id,
  detail: "p=0.91",
  active: true,
  units,
});

const decision = (over: Partial<PullDecision>): PullDecision =>
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
    recommendation: "auto-approve",
    reason: "Low risk.",
    ...over,
  }) as PullDecision;

const withFindings = (findings: Finding[], over: Partial<PullDecision> = {}) =>
  decision({
    findings,
    scope: { appliedRules: [], actions: DEFAULT_SEVERITY.actions, signalsCanRequestChanges: true, extraReviewers: [] },
    guardrails: { tier: "standard", lines: 10, files: 1, aiAuthored: false, requireHuman: [], approveBlockers: [], notes: [] },
    ...over,
  });

function plan(d: PullDecision, authority: ActionAuthority, opts: { unlocked?: boolean; checks?: typeof DEFAULT_CHECKS; hunks?: HunkRecord[] } = {}) {
  return planReviewActions([d], [{ number: 7, headSha: "sha2" }], {
    repoId: REPO,
    authority,
    approvalUnlocked: opts.unlocked ?? false,
    checks: opts.checks ?? { ...DEFAULT_CHECKS, enabled: true },
    hunks: opts.hunks ?? [],
  });
}

describe("locations", () => {
  it("reads the new-side range from a hunk header", () => {
    expect(hunkNewRange("@@ -10,4 +12,6 @@ fn()")).toEqual({ start: 12, end: 17 });
    expect(hunkNewRange("@@ -0,0 +1,3 @@")).toEqual({ start: 1, end: 3 });
    expect(hunkNewRange("@@ -3 +3 @@")).toEqual({ start: 3, end: 3 });
    // A deleted file has no new-side lines; a deletion-only hunk anchors to the line before it.
    expect(hunkNewRange("@@ -1,9 +0,0 @@")).toBeNull();
    expect(hunkNewRange("@@ -5,2 +4,0 @@")).toEqual({ start: 4, end: 4 });
    expect(hunkNewRange("")).toBeNull();
  });

  it("parses unit keys, including split parts and paths containing #", () => {
    expect(parseUnitKey("src/a.ts#2")).toEqual({ path: "src/a.ts", index: 2 });
    expect(parseUnitKey("src/a.ts#2.1")).toEqual({ path: "src/a.ts", index: 2 });
    expect(parseUnitKey("docs/c#.md#0")).toEqual({ path: "docs/c#.md", index: 0 });
    expect(parseUnitKey("nohash")).toBeNull();
  });

  it("locates a finding once per hunk, skipping patchless and deleted hunks", () => {
    const hunks = [
      hunk("src/a.ts", 0, "@@ -1,2 +1,3 @@"),
      hunk("src/a.ts", 1, "@@ -20,2 +21,2 @@"),
      hunk("bin/x", 0, "", { noPatch: true }),
      hunk("old.ts", 0, "@@ -1,4 +0,0 @@"),
    ];
    const f = signal("signal:touchesAuthz", "p0", ["src/a.ts#1", "src/a.ts#1.1", "src/a.ts#0", "bin/x#0", "old.ts#0"]);
    expect(locateFinding(f, hunks).map((l) => [l.path, l.startLine, l.endLine])).toEqual([
      ["src/a.ts", 1, 3],
      ["src/a.ts", 21, 22],
    ]);
    expect(locateFinding({ units: undefined }, hunks)).toEqual([]);
  });
});

describe("check conclusion", () => {
  it("only an act-level approval passes; only an act-level change request may fail", () => {
    expect(checkConclusion("approve", "act", "never")).toBe("success");
    expect(checkConclusion("approve", "comment", "request-changes")).toBe("neutral");
    expect(checkConclusion("request_changes", "act", "request-changes")).toBe("failure");
    expect(checkConclusion("request_changes", "act", "never")).toBe("neutral");
    expect(checkConclusion("request_changes", "comment", "request-changes")).toBe("neutral");
    expect(checkConclusion("defer_to_human", "act", "request-changes")).toBe("neutral");
    for (const a of ["approve", "request_changes", "defer_to_human"] as const) expect(checkConclusion(a, "off", "request-changes")).toBeNull();
  });
});

describe("planned check runs", () => {
  it("are absent when checks are off, and in the legacy (authority-less) plan", () => {
    const [off] = plan(decision({}), MODE_AUTHORITY.full, { checks: DEFAULT_CHECKS });
    expect(off!.call.checkRun).toBeUndefined();
    expect(off!.check).toBeUndefined();
    const [legacy] = planReviewActions([decision({})], [{ number: 7, headSha: "sha2" }], { repoId: REPO, checks: { ...DEFAULT_CHECKS, enabled: true } });
    expect(legacy!.call.checkRun).toBeUndefined();
  });

  it("Evaluation never fails or passes the check outright", () => {
    for (const d of [decision({}), decision({ recommendation: "request-changes" }), decision({ recommendation: "escalate" })]) {
      const [a] = plan(d, MODE_AUTHORITY.evaluation, { unlocked: true, checks: { ...DEFAULT_CHECKS, enabled: true, blockOn: "request-changes" } });
      expect(a!.call.checkRun!.conclusion).toBe("neutral");
      expect(a!.call.checkRun!.output.title).toMatch(/^PullUp would/);
    }
  });

  it("a clamped approval is neutral and says approval is locked; an unlocked one passes", () => {
    const [locked] = plan(decision({}), MODE_AUTHORITY.full);
    expect(locked!.authority).toBe("comment");
    expect(locked!.call.checkRun).toMatchObject({ conclusion: "neutral", head_sha: "sha2", name: "PullUp" });
    expect(locked!.call.checkRun!.output.title).toContain("approval locked");
    const [unlocked] = plan(decision({}), MODE_AUTHORITY.full, { unlocked: true });
    expect(unlocked!.call.checkRun!.conclusion).toBe("success");
  });

  it("a change request fails the check only when the owner opted in", () => {
    const d = decision({ recommendation: "request-changes" });
    expect(plan(d, MODE_AUTHORITY.full)[0]!.call.checkRun!.conclusion).toBe("neutral");
    const [blocking] = plan(d, MODE_AUTHORITY.full, { checks: { ...DEFAULT_CHECKS, enabled: true, blockOn: "request-changes" } });
    expect(blocking!.call.checkRun!.conclusion).toBe("failure");
  });

  it("governance lowering also lowers the check (comment → neutral, off → none)", () => {
    const [a] = plan(decision({ recommendation: "request-changes" }), MODE_AUTHORITY.full, { checks: { ...DEFAULT_CHECKS, enabled: true, blockOn: "request-changes" } });
    expect(a!.call.checkRun!.conclusion).toBe("failure");
    expect(lowerAction(a!, "comment").call.checkRun!.conclusion).toBe("neutral");
    expect(lowerAction(a!, "off").call.checkRun).toBeNull();
  });

  it("the agent's rationale replaces the check text but not the conclusion", () => {
    const [a] = plan(decision({ recommendation: "request-changes" }), MODE_AUTHORITY.full, { checks: { ...DEFAULT_CHECKS, enabled: true, blockOn: "request-changes" } });
    const b = withReviewBody(a!, "Removes the admin check in scheduler.ts.");
    expect(b.call.checkRun!.output.text).toContain("Removes the admin check");
    expect(b.call.checkRun!.conclusion).toBe("failure");
  });

  it("annotates located findings by level, and keeps the decision identical with checks on or off", () => {
    const hunks = [hunk("src/auth.ts", 0, "@@ -1,2 +1,4 @@"), hunk("src/b.ts", 0, "@@ -3,1 +3,2 @@")];
    const d = withFindings([signal("signal:changesConcurrency", "p1", ["src/b.ts#0"]), signal("signal:touchesAuthz", "p0", ["src/auth.ts#0"])]);
    const [on] = plan(d, MODE_AUTHORITY.full, { hunks });
    const [off] = plan(d, MODE_AUTHORITY.full, { hunks, checks: DEFAULT_CHECKS });
    expect(on!.call.checkRun!.output.annotations).toEqual([
      expect.objectContaining({ path: "src/auth.ts", start_line: 1, end_line: 4, annotation_level: "failure" }),
      expect.objectContaining({ path: "src/b.ts", start_line: 3, end_line: 4, annotation_level: "warning" }),
    ]);
    const { call: _c1, check: _k1, ...a } = on!;
    const { call: _c2, ...b } = off!;
    expect(a).toEqual(b);
    expect(on!.call.createReview).toEqual(off!.call.createReview);
    const [noAnn] = plan(d, MODE_AUTHORITY.full, { hunks, checks: { ...DEFAULT_CHECKS, enabled: true, annotations: false } });
    expect(noAnn!.call.checkRun!.output.annotations).toEqual([]);
  });

  it("caps annotations at GitHub's limit and counts the rest", () => {
    const hunks = Array.from({ length: 60 }, (_, i) => hunk(`f${String(i).padStart(2, "0")}.ts`, 0, "@@ -1 +1 @@"));
    const f = signal("signal:x", "p1", hunks.map((h) => `${h.path}#0`));
    const { annotations, more } = checkAnnotations([f], hunks);
    expect(annotations).toHaveLength(CHECK_ANNOTATION_LIMIT);
    expect(more).toBe(10);
  });
});
