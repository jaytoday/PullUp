// Safety contract for guardrails + action authority, end-to-end on the bundled
// fixtures with the deterministic synthetic model.

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../config/config.js";
import type { ConfigFile } from "../config/schema.js";
import { APPROVABLE_TIERS, DEP_UPDATE_KINDS } from "../config/guardrails.js";
import type { PullDecision } from "../cost/decision.js";
import { ingestRepo } from "../ingest/pipeline.js";
import type { FixtureFile } from "../ingest/source.js";
import { REQUIRE_HUMAN_CATEGORIES } from "../policy/categories.js";
import { buildReport } from "../report/build.js";
import { InMemoryStore } from "../schema/store.js";
import { resolveJevConfig } from "../signals/config.js";
import { resolveQuestionSet } from "../signals/questions/custom.js";
import { runSignals } from "../signals/run.js";
import type { JevRuntime } from "../signals/runtime.js";
import { mulberry32 } from "../testing/generate.js";
import { sourceFromFixtureFile } from "../testing/hunks.js";
import { SyntheticSignalModel } from "../testing/synthetic-signals.js";
import type { ActionAuthority } from "./authority.js";
import { AUTHORITY_LEVELS, MODE_AUTHORITY } from "./authority.js";
import { DECISION_COMMENT_MARKER, LoggingReviewActuator, planReviewActions } from "./review.js";

const NOW = "2026-09-01T00:00:00.000Z";
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../../fixtures/${name}.json`, import.meta.url), "utf8")) as FixtureFile;

async function load(name: string, file: ConfigFile = {}) {
  const store = new InMemoryStore();
  await ingestRepo(sourceFromFixtureFile(fixture(name)), store, { now: NOW });
  const cfg = resolveConfig({ file });
  const qs = resolveQuestionSet(cfg.jev);
  await runSignals(store, `fixtures/${name}`, new SyntheticSignalModel(), qs, { now: NOW });
  return store;
}

function runtimeFor(file: ConfigFile): JevRuntime {
  const cfg = resolveConfig({ file });
  return { config: cfg.jev, policy: cfg.policy, qs: resolveQuestionSet(cfg.jev), modelId: "synthetic-v1", calibration: null };
}

async function decide(store: InMemoryStore, repo: string, file: ConfigFile) {
  const cfg = resolveConfig({ file });
  return buildReport(store, repo, cfg.priors, {
    now: NOW,
    jev: cfg.jev.mode === "off" ? undefined : runtimeFor(file),
    guardrails: { config: cfg.guardrails, policy: cfg.policy },
  });
}

async function plan(store: InMemoryStore, repo: string, file: ConfigFile, decisions?: readonly PullDecision[]) {
  const cfg = resolveConfig({ file });
  const d = decisions ?? (await decide(store, repo, file)).decisions;
  return planReviewActions(d, await store.listPulls(repo), {
    repoId: repo,
    humanReviewers: ["security-team"],
    authority: cfg.authority,
  });
}

const ALL_AUTHORITIES: ActionAuthority[] = AUTHORITY_LEVELS.flatMap((a) =>
  AUTHORITY_LEVELS.flatMap((r) => AUTHORITY_LEVELS.map((h) => ({ approve: a, requestChanges: r, requestHuman: h }))),
);

describe("action authority (fixtures/jev, active signals)", () => {
  const repo = "fixtures/jev";
  let store: InMemoryStore;
  beforeAll(async () => {
    store = await load("jev");
  });

  it("decisions are identical at every authority level", async () => {
    const reports = await Promise.all(
      ALL_AUTHORITIES.map((a) => decide(store, repo, { jev: { mode: "active" }, actions: a })),
    );
    const key = (r: (typeof reports)[number]) => JSON.stringify(r.decisions.map((d) => [d.pullNumber, d.recommendation, d.maxWaitHours, d.reason]));
    for (const r of reports) expect(key(r)).toBe(key(reports[0]!));
  });

  it("comment and off never emit APPROVE or REQUEST_CHANGES; off sends nothing", async () => {
    for (const a of ALL_AUTHORITIES) {
      for (const p of await plan(store, repo, { jev: { mode: "active" }, actions: a })) {
        if (p.authority === "act") continue;
        expect(p.call.createReview).toBeNull();
        expect(p.call.requestReviewers).toBeNull();
        if (p.authority === "off") expect(p.call.upsertComment).toBeNull();
        else expect(p.call.upsertComment!.body.startsWith(DECISION_COMMENT_MARKER)).toBe(true);
      }
    }
  });

  it("evaluation mode comments what it would do on every acted-on PR", async () => {
    const planned = await plan(store, repo, { jev: { mode: "active" }, actions: MODE_AUTHORITY.evaluation });
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((p) => p.authority === "comment")).toBe(true);
    const docs = planned.find((p) => p.pullNumber === 1003)!;
    expect(docs.action).toBe("approve");
    expect(docs.call.upsertComment!.body).toMatch(/PullUp would approve this PR/);
  });

  it("block only: requests changes and asks humans for real, only comments approvals", async () => {
    const planned = await plan(store, repo, { jev: { mode: "active" }, actions: MODE_AUTHORITY["block-only"] });
    for (const p of planned) {
      expect(p.authority).toBe(p.action === "approve" ? "comment" : "act");
      if (p.action === "request_changes") expect(p.call.createReview!.event).toBe("REQUEST_CHANGES");
      if (p.action === "defer_to_human") {
        expect(p.call.createReview).toBeNull();
        expect(p.call.requestReviewers!.reviewers).toEqual(["security-team"]);
        expect(p.call.upsertComment!.body).toMatch(/asking for a human review/);
      }
    }
  });

  it("approve · act is clamped to comment while approval is stubbed", async () => {
    const cfg = resolveConfig({ file: { jev: { mode: "active" }, actions: MODE_AUTHORITY.full } });
    const decisions = (await decide(store, repo, { jev: { mode: "active" } })).decisions;
    const pulls = await store.listPulls(repo);
    const stubbed = planReviewActions(decisions, pulls, { repoId: repo, authority: cfg.authority });
    const approvals = stubbed.filter((p) => p.action === "approve");
    expect(approvals.length).toBeGreaterThan(0);
    for (const p of approvals) {
      expect(p.authority).toBe("comment");
      expect(p.clamped).toMatch(/stubbed/);
      expect(p.call.createReview).toBeNull();
    }
    const unlocked = planReviewActions(decisions, pulls, { repoId: repo, authority: cfg.authority, approvalUnlocked: true });
    expect(unlocked.filter((p) => p.action === "approve").every((p) => p.call.createReview?.event === "APPROVE")).toBe(true);
  });

  it("off is recorded as suppressed", async () => {
    const planned = await plan(store, repo, { jev: { mode: "active" }, actions: MODE_AUTHORITY.off });
    const logged = await new LoggingReviewActuator(new InMemoryStore(), () => NOW).apply(planned);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((l) => l.status === "suppressed")).toBe(true);
  });
});

describe("guardrails in decisions (fixtures/jev)", () => {
  const repo = "fixtures/jev";
  let store: InMemoryStore;
  beforeAll(async () => {
    store = await load("jev");
  });

  it("a first-time contributor is escalated even with the Jev layer off", async () => {
    const r = await decide(store, repo, {});
    const d = r.decisions.find((x) => x.pullNumber === 1002)!;
    expect(d.recommendation).toBe("escalate");
    expect(d.guardrails!.requireHuman).toContain("First-time contributor: mallory");
    // A CI workflow edit escalates via its category.
    expect(r.decisions.find((x) => x.pullNumber === 1001)!.recommendation).toBe("escalate");
    expect(r.guardrails!.escalated).toBeGreaterThanOrEqual(2);
  });

  it("a blocker turns an approval into a deferral, never an approval", async () => {
    // The docs PR (#1003) is auto-approved by the TCM; a 0-line limit blocks it.
    const open = await plan(store, repo, {});
    expect(open.find((p) => p.pullNumber === 1003)!.action).toBe("approve");
    const blocked = await plan(store, repo, { guardrails: { maxAutoApproveLines: 0 } });
    const p = blocked.find((x) => x.pullNumber === 1003)!;
    expect(p).toMatchObject({ action: "defer_to_human", source: "guardrail" });
    expect(p.reason).toMatch(/lines > 0-line limit/);
    expect(blocked.some((x) => x.action === "approve")).toBe(false);
  });

  it("custom questions only ever raise risk: never escalate, never approve", async () => {
    const file: ConfigFile = {
      jev: { mode: "active", customQuestions: [{ text: "change typos or spelling in the install guide" }] },
    };
    const s = await load("jev", file);
    // Cache answers for the base question set too, so the comparison is fair.
    await runSignals(s, repo, new SyntheticSignalModel(), resolveQuestionSet(resolveJevConfig()), { now: NOW });
    const r = await decide(s, repo, file);
    const d = r.decisions.find((x) => x.pullNumber === 1003)!;
    expect(d.risk!.band).toBe("review-with-rationale");
    expect(d.risk!.reviewReasons.join()).toMatch(/custom:/);
    const base = await decide(s, repo, { jev: { mode: "active" } });
    for (const x of r.decisions) {
      const b = base.decisions.find((y) => y.pullNumber === x.pullNumber)!;
      // Custom questions never add escalations and never add approvals.
      if (x.recommendation === "escalate") expect(b.recommendation).toBe("escalate");
      if (b.recommendation !== "auto-approve") expect(x.recommendation).not.toBe("auto-approve");
    }
  });
});

describe("tightening guardrails never adds an approval (property)", () => {
  const rand = mulberry32(20260923);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const limit = () => (rand() < 0.2 ? null : Math.floor(rand() * 21) * 50);

  function tighten(loose: ConfigFile["guardrails"] & object): ConfigFile["guardrails"] & object {
    const lines = loose.maxAutoApproveLines ?? 1000;
    const files = loose.maxAutoApproveFiles ?? 50;
    const tier = APPROVABLE_TIERS.indexOf(loose.approveMaxTier!);
    const cats = { ...loose.requireHumanCategories } as Record<string, boolean>;
    for (const c of REQUIRE_HUMAN_CATEGORIES) if (!c.locked && rand() < 0.3) cats[c.id] = true;
    return {
      maxAutoApproveLines: Math.floor((rand() * lines) / 50) * 50,
      maxAutoApproveFiles: Math.max(1, Math.floor(rand() * files)),
      approveMaxTier: APPROVABLE_TIERS[Math.floor(rand() * (tier + 1))]!,
      requireHumanCategories: cats as never,
      dependencies: { autoApprove: loose.dependencies!.autoApprove!.filter(() => rand() < 0.6) },
      tests: { requireForBehaviorChange: loose.tests!.requireForBehaviorChange || rand() < 0.3 },
    };
  }

  for (const name of ["healthy", "congested", "jev"]) {
    it(name, async () => {
      const store = await load(name);
      const repo = `fixtures/${name}`;
      for (let i = 0; i < 12; i++) {
        const cats: Record<string, boolean> = {};
        for (const c of REQUIRE_HUMAN_CATEGORIES) if (!c.locked) cats[c.id] = rand() < 0.5;
        const loose = {
          maxAutoApproveLines: limit(),
          maxAutoApproveFiles: rand() < 0.3 ? null : 1 + Math.floor(rand() * 50),
          approveMaxTier: pick(APPROVABLE_TIERS),
          requireHumanCategories: cats as never,
          dependencies: { autoApprove: DEP_UPDATE_KINDS.filter(() => rand() < 0.7) },
          tests: { requireForBehaviorChange: rand() < 0.3 },
        };
        const tight = tighten(loose);
        const approvedBy = async (g: ConfigFile["guardrails"]) =>
          new Set(
            (await plan(store, repo, { guardrails: g, actions: MODE_AUTHORITY.full }))
              .filter((p) => p.action === "approve")
              .map((p) => p.pullNumber),
          );
        const looseSet = await approvedBy(loose);
        for (const n of await approvedBy(tight)) expect(looseSet.has(n), `#${n} iteration ${i}`).toBe(true);
      }
    }, 60_000);
  }
});

describe("legacy plan without authority is unchanged", () => {
  it("APPROVE / COMMENT review calls as before", async () => {
    const store = await load("jev");
    const cfg = resolveJevConfig({ mode: "active" });
    const r = await buildReport(store, "fixtures/jev", resolveConfig().priors, {
      now: NOW,
      jev: { config: cfg, policy: resolveConfig().policy, qs: resolveQuestionSet(cfg), modelId: "synthetic-v1", calibration: null },
    });
    const planned = planReviewActions(r.decisions, await store.listPulls("fixtures/jev"), { repoId: "fixtures/jev" });
    for (const p of planned) {
      expect(p.authority).toBeUndefined();
      expect(p.call.createReview).not.toBeNull();
      expect(p.call.upsertComment).toBeUndefined();
    }
  });
});
