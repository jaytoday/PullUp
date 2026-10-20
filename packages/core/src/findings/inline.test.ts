// Inline finding comments: what to post, keep and resolve, and the rule that
// they are information only (decisions and actions identical with them on or off).

import { describe, expect, it } from "vitest";
import { MODE_AUTHORITY } from "../actions/authority.js";
import { planReviewActions } from "../actions/review.js";
import { governActions } from "../authority/authorize.js";
import type { ControlSnapshot } from "../authority/authorize.js";
import { DEFAULT_INLINE } from "../config/inline.js";
import type { InlineConfig } from "../config/inline.js";
import { DEFAULT_SEVERITY } from "../config/severity.js";
import type { PullDecision } from "../cost/decision.js";
import type { FindingCommentRecord, HunkRecord } from "../schema/domain.js";
import type { Finding } from "./findings.js";
import { findingKey, findingMarker, planInline } from "./inline.js";

const REPO = "acme/api";
const ON: InlineConfig = { ...DEFAULT_INLINE, enabled: true };

const hunk = (path: string, index: number, header = "@@ -1,2 +1,4 @@"): HunkRecord => ({
  repoId: REPO,
  pullNumber: 7,
  path,
  index,
  header,
  patch: "+x",
  noPatch: false,
  contentHash: `${path}#${index}`,
});

const f = (id: string, level: Finding["level"], units: string[], over: Partial<Finding> = {}): Finding => ({
  id,
  level,
  source: "signal",
  kind: "signal",
  title: id,
  detail: "p=0.91 · x",
  active: true,
  units,
  ...over,
});

const stored = (findingIdValue: string, path: string, over: Partial<FindingCommentRecord> = {}): FindingCommentRecord => ({
  repoId: REPO,
  pullNumber: 7,
  findingKey: findingKey(findingIdValue, path),
  findingId: findingIdValue,
  path,
  commentId: 500,
  firstHeadSha: "sha1",
  lastSeenHeadSha: "sha1",
  status: "open",
  resolvedHeadSha: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const base = { config: ON, hunks: [hunk("src/auth.ts", 0), hunk("src/b.ts", 0), hunk("src/c.ts", 0)], existing: [], headSha: "sha2abcdef", signalsRan: true };

describe("planInline", () => {
  it("posts P0 and P1 located findings by default, with the marker, and skips P2 and rule findings", () => {
    const plan = planInline({
      ...base,
      findings: [
        f("signal:touchesAuthz", "p0", ["src/auth.ts#0"]),
        f("signal:changesConcurrency", "p1", ["src/b.ts#0"]),
        f("signal:addsNetworkCall", "p2", ["src/c.ts#0"]),
        { id: "rule:tests-missing", level: "p1", source: "rule", kind: "tests-missing", title: "t", detail: "d", active: true },
      ],
    });
    expect(plan.post.map((c) => [c.findingId, c.path, c.start_line, c.line])).toEqual([
      ["signal:touchesAuthz", "src/auth.ts", 1, 4],
      ["signal:changesConcurrency", "src/b.ts", 1, 4],
    ]);
    expect(plan.post[0]!.body).toContain(findingMarker(findingKey("signal:touchesAuthz", "src/auth.ts")));
    expect(plan.post[0]!.body).toContain("Possible change to an authorization check");
    expect(plan.post[0]!.body).toContain("head `sha2abc`");
  });

  it("keys are stable across pushes, so an open comment is kept, not re-posted", () => {
    const plan = planInline({ ...base, findings: [f("signal:touchesAuthz", "p0", ["src/auth.ts#0"])], existing: [stored("signal:touchesAuthz", "src/auth.ts")] });
    expect(plan.post).toEqual([]);
    expect(plan.keep).toEqual([findingKey("signal:touchesAuthz", "src/auth.ts")]);
    expect(plan.resolve).toEqual([]);
  });

  it("never re-posts a finding a human resolved, but does re-post one PullUp resolved that came back", () => {
    const findings = [f("signal:touchesAuthz", "p0", ["src/auth.ts#0"]), f("signal:changesConcurrency", "p1", ["src/b.ts#0"])];
    const plan = planInline({
      ...base,
      findings,
      existing: [stored("signal:touchesAuthz", "src/auth.ts", { status: "resolved-by-human" }), stored("signal:changesConcurrency", "src/b.ts", { status: "resolved-by-pullup", commentId: 501 })],
    });
    expect(plan.post.map((c) => c.findingId)).toEqual(["signal:changesConcurrency"]);
    expect(plan.notPosted[0]!.reason).toMatch(/human resolved/);
  });

  it("resolves PullUp's own open comment when its finding is gone, and when the file left the pull request", () => {
    const plan = planInline({
      ...base,
      findings: [],
      existing: [stored("signal:touchesAuthz", "src/auth.ts"), stored("signal:handlesSecrets", "src/gone.ts", { commentId: 502 })],
    });
    expect(plan.resolve.map((r) => [r.commentId, r.why])).toEqual([
      [500, "fixed"],
      [502, "file-removed"],
    ]);
    expect(plan.resolve[0]!.reply).toContain("No longer flagged at `sha2abc`");
  });

  it("doesn't resolve while the file had unevaluated units, or when signals didn't run", () => {
    const existing = [stored("signal:touchesAuthz", "src/auth.ts")];
    const unevaluated: Finding = { id: "signal:unevaluated", level: "p1", source: "signal", kind: "unevaluated", title: "u", detail: "", active: true, units: ["src/auth.ts#0"] };
    expect(planInline({ ...base, findings: [unevaluated], existing }).resolve).toEqual([]);
    expect(planInline({ ...base, findings: [], existing, signalsRan: false })).toMatchObject({ post: [], resolve: [] });
  });

  it("a finding below reportOn or outside active signals still counts as present (no resolve)", () => {
    const existing = [stored("signal:touchesAuthz", "src/auth.ts")];
    const plan = planInline({ ...base, config: { ...ON, reportOn: "p0" }, findings: [f("signal:touchesAuthz", "p1", ["src/auth.ts#0"], { active: false })], existing });
    expect(plan.resolve).toEqual([]);
    expect(plan.keep).toHaveLength(1);
  });

  it("observe-only findings are posted only when the owner asks", () => {
    const findings = [f("signal:touchesAuthz", "p0", ["src/auth.ts#0"], { active: false })];
    expect(planInline({ ...base, findings }).post).toEqual([]);
    const plan = planInline({ ...base, config: { ...ON, includeObserve: true }, findings });
    expect(plan.post[0]!.body).toContain("observe only");
  });

  it("posts nothing on an injection pull request", () => {
    const plan = planInline({
      ...base,
      findings: [f("signal:touchesAuthz", "p0", ["src/auth.ts#0"]), f("signal:addressesReviewerOrAutomation", "p0", ["src/b.ts#0"], { kind: "injection" })],
      existing: [stored("signal:x", "src/c.ts")],
    });
    expect(plan).toMatchObject({ post: [], resolve: [] });
  });

  it("caps new comments and resolutions, and skips deletion-only hunks", () => {
    const hunks = Array.from({ length: 5 }, (_, i) => hunk(`f${i}.ts`, 0));
    const many = hunks.map((h, i) => f(`signal:q${i}`, "p1", [`${h.path}#0`]));
    const plan = planInline({ ...base, hunks, config: { ...ON, maxComments: 2 }, findings: many });
    expect(plan.post).toHaveLength(2);
    expect(plan.notPosted.filter((n) => /limit/.test(n.reason))).toHaveLength(3);
    const existing = hunks.map((h, i) => stored(`signal:gone${i}`, h.path, { commentId: 600 + i }));
    expect(planInline({ ...base, hunks, config: { ...ON, maxResolutions: 3 }, findings: [], existing }).resolve).toHaveLength(3);
    const del = planInline({ ...base, hunks: [hunk("src/d.ts", 0, "@@ -5,2 +4,0 @@")], findings: [f("signal:x", "p0", ["src/d.ts#0"])] });
    expect(del.post).toEqual([]);
    expect(del.notPosted[0]!.reason).toMatch(/deletion only/);
  });
});

const decision = (findings: Finding[]): PullDecision =>
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
    recommendation: "keep-reviewing",
    reason: "r",
    findings,
    risk: { mode: "active" } as PullDecision["risk"],
    scope: { appliedRules: [], actions: DEFAULT_SEVERITY.actions, signalsCanRequestChanges: false, extraReviewers: [] },
    guardrails: { tier: "standard", lines: 10, files: 1, aiAuthored: false, requireHuman: [], approveBlockers: [], notes: [] },
  }) as PullDecision;

describe("inline comments in the plan", () => {
  const d = decision([f("signal:touchesAuthz", "p0", ["src/auth.ts#0"])]);
  const plan = (inline: InlineConfig, authority = MODE_AUTHORITY.evaluation) =>
    planReviewActions([d], [{ number: 7, headSha: "sha2" }], { repoId: REPO, authority, inline, hunks: base.hunks });

  it("ride on the action at comment level and change nothing else", () => {
    const [on] = plan(ON);
    const [off] = plan(DEFAULT_INLINE);
    expect(on!.call.inlineReview!.comments).toHaveLength(1);
    expect(on!.call.inlineReview!.event).toBe("COMMENT");
    const { call: c1, inline: _i, ...a } = on!;
    const { call: c2, ...b } = off!;
    expect(a).toEqual(b);
    expect(c1.upsertComment).toEqual(c2.upsertComment);
  });

  it("are dropped at off, and by the Observe profile; their token gets pull-request write", () => {
    const [atOff] = plan(ON, MODE_AUTHORITY.off);
    expect(atOff!.call.inlineReview).toBeNull();
    const snapshot = (profile: ControlSnapshot["profile"]): ControlSnapshot => ({ profile, agentStatus: "approved", stop: { stopped: false, reason: "" } });
    const govern = (profile: ControlSnapshot["profile"]) =>
      governActions(plan(ON), {
        initiator: { kind: "cli", ref: null },
        agent: { id: "a", version: "v" },
        config: { version: null, hash: "h" },
        snapshot: snapshot(profile),
        delivery: "log",
        credential: null,
        permitKey: null,
        sign: false,
        now: "2026-10-01T00:00:00.000Z",
      })[0]!;
    expect(govern("observe").call.inlineReview).toBeNull();
    const review = govern("review");
    expect(review.call.inlineReview!.comments).toHaveLength(1);
    expect(review.authorization!.permissions).toMatchObject({ pull_requests: "write" });
  });
});
