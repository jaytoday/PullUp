// Severity (P0/P1/P2) findings and scoped rules: unit behaviour plus the
// safety contract end-to-end on fixtures/jev with the synthetic model.

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { MODE_AUTHORITY } from "../actions/authority.js";
import { planReviewActions } from "../actions/review.js";
import type { PlannedReviewAction } from "../actions/review.js";
import { resolveConfig } from "../config/config.js";
import { diffConfig } from "../config/fields.js";
import type { ReviewRule } from "../config/rules.js";
import { applyRules, basePolicy, describeRule, matchRule } from "../config/rules.js";
import type { ConfigFile } from "../config/schema.js";
import { configFileSchema, effectiveConfigFile } from "../config/schema.js";
import { DEFAULT_SEVERITY } from "../config/severity.js";
import { DEFAULT_GUARDRAILS } from "../config/guardrails.js";
import type { PullDecision } from "../cost/decision.js";
import { ingestRepo } from "../ingest/pipeline.js";
import type { FixtureFile } from "../ingest/source.js";
import { buildReport } from "../report/build.js";
import { InMemoryStore } from "../schema/store.js";
import { resolveQuestionSet } from "../signals/questions/custom.js";
import { runSignals } from "../signals/run.js";
import { mulberry32 } from "../testing/generate.js";
import { sourceFromFixtureFile } from "../testing/hunks.js";
import { SyntheticSignalModel } from "../testing/synthetic-signals.js";
import { collectFindings, questionLevel } from "./findings.js";

const NOW = "2026-09-01T00:00:00.000Z";
const REPO = "fixtures/jev";
const subject = (files: string[], author = "alice", labels: string[] = []) => ({ files, author, labels });
const rule = (r: Partial<ReviewRule> & Pick<ReviewRule, "when" | "set">): ReviewRule => ({ name: "R", ...r });

describe("rule matching and combination", () => {
  it("any / all path matching, authors and labels", () => {
    const any = rule({ when: { paths: ["src/billing/**"] }, set: { requireHuman: true } });
    expect(matchRule(any, subject(["docs/a.md", "src/billing/x.ts"]))).toEqual({ name: "R", mode: "stricter" });
    expect(matchRule(any, subject(["docs/a.md"]))).toBeNull();
    const all = rule({ when: { paths: ["docs/**"], pathMatch: "all" }, set: { severity: { p1: "note" } } });
    expect(matchRule(all, subject(["docs/a.md"]))).toEqual({ name: "R", mode: "override" });
    expect(matchRule(all, subject(["docs/a.md", "src/x.ts"]))).toBeNull();
    const who = rule({ when: { authors: ["renovate*"], labels: ["deps"] }, set: { maxLines: 800 } });
    expect(matchRule(who, subject(["package.json"], "renovate[bot]", ["deps"]))).toEqual({ name: "R", mode: "override" });
    expect(matchRule(who, subject(["package.json"], "renovate[bot]", []))).toBeNull();
  });

  it("a partial path match can only tighten", () => {
    const base = basePolicy({ ...DEFAULT_GUARDRAILS, maxAutoApproveLines: 300 }, DEFAULT_SEVERITY);
    const lenient = rule({ when: { paths: ["docs/**"] }, set: { maxLines: 1000, severity: { p1: "note" }, requireTests: false } });
    const { policy } = applyRules(base, [lenient], subject(["docs/a.md", "src/auth/x.ts"]));
    expect(policy.maxLines).toBe(300);
    expect(policy.actions.p1).toBe("ask-human");
    const strict = rule({ when: { paths: ["src/auth/**"] }, set: { maxLines: 100, severity: { p1: "request-changes" } } });
    const both = applyRules(base, [lenient, strict], subject(["docs/a.md", "src/auth/x.ts"]));
    expect(both.policy).toMatchObject({ maxLines: 100, actions: { p1: "request-changes" } });
  });

  it("author/label and every-file rules may loosen; later overrides win, stricter rules still apply", () => {
    const base = basePolicy({ ...DEFAULT_GUARDRAILS, maxAutoApproveLines: 300 }, DEFAULT_SEVERITY);
    const r1 = rule({ name: "A", when: { authors: ["alice"] }, set: { maxLines: 600 } });
    const r2 = rule({ name: "B", when: { authors: ["ali*"] }, set: { maxLines: 800 } });
    const r3 = rule({ name: "C", when: { paths: ["src/**"] }, set: { maxLines: 200, reviewers: ["core-team"] } });
    const { policy, applied } = applyRules(base, [r1, r2, r3], subject(["src/x.ts"]));
    expect(applied.map((a) => a.name)).toEqual(["A", "B", "C"]);
    expect(policy.maxLines).toBe(200);
    expect(policy.extraReviewers).toEqual(["core-team"]);
    expect(applyRules(base, [r1, r2], subject(["src/x.ts"])).policy.maxLines).toBe(800);
  });

  it("describes rules in plain language", () => {
    expect(
      describeRule(rule({ when: { paths: ["src/billing/**"] }, set: { requireHuman: true, severity: { p1: "request-changes" } } })),
    ).toBe("files in src/billing/** → always a human; P1 → request changes");
  });
});

describe("schema", () => {
  it("P0 can't be a note; P2 can't request changes", () => {
    expect(configFileSchema.safeParse({ severity: { actions: { p0: "note" } } }).success).toBe(false);
    expect(configFileSchema.safeParse({ severity: { actions: { p2: "request-changes" } } }).success).toBe(false);
    expect(configFileSchema.safeParse({ severity: { actions: { p1: "note" } } }).success).toBe(true);
  });

  it("rules need a condition and an effect, unique names, valid globs", () => {
    const ok = { name: "Billing", when: { paths: ["src/billing/**"] }, set: { requireHuman: true } };
    expect(configFileSchema.safeParse({ rules: [ok] }).success).toBe(true);
    expect(configFileSchema.safeParse({ rules: [{ ...ok, when: {} }] }).success).toBe(false);
    expect(configFileSchema.safeParse({ rules: [{ ...ok, set: {} }] }).success).toBe(false);
    expect(configFileSchema.safeParse({ rules: [ok, { ...ok }] }).success).toBe(false);
    expect(configFileSchema.safeParse({ rules: [{ ...ok, when: { paths: ["../x"] } }] }).success).toBe(false);
    expect(configFileSchema.safeParse({ rules: [{ ...ok, set: { severity: { p0: "note" } } }] }).success).toBe(false);
  });
});

describe("diff labels for severity and rules", () => {
  const eff = (f: ConfigFile) => effectiveConfigFile({}, f);
  it("P1 → note loosens; P1 → request changes tightens", () => {
    expect(diffConfig(eff({}), eff({ severity: { actions: { p1: "note" } } }))[0]!.direction).toBe("loosens");
    expect(diffConfig(eff({}), eff({ severity: { actions: { p1: "request-changes" } } }))[0]!.direction).toBe("tightens");
    expect(diffConfig(eff({}), eff({ severity: { questionLevels: { touchesAuthz: "p2" } } }))[0]!.direction).toBe("loosens");
  });

  it("adding a loosening rule loosens; a stricter-only rule tightens; removing a strict rule loosens", () => {
    const base: ConfigFile = { guardrails: { maxAutoApproveLines: 300 } };
    const lenient: ReviewRule = { name: "Maint", when: { authors: ["alice"] }, set: { maxLines: 600 } };
    const partial: ReviewRule = { name: "Docs", when: { paths: ["docs/**"] }, set: { maxLines: 900 } };
    const strict: ReviewRule = { name: "Billing", when: { paths: ["src/billing/**"] }, set: { requireHuman: true } };
    const d = (a: ConfigFile, b: ConfigFile) => diffConfig(eff(a), eff(b)).find((c) => c.path === "rules")!;
    expect(d(base, { ...base, rules: [lenient] }).direction).toBe("loosens");
    expect(d(base, { ...base, rules: [partial] }).direction).toBe("neutral");
    expect(d(base, { ...base, rules: [strict] }).direction).toBe("tightens");
    expect(d({ ...base, rules: [strict] }, base).direction).toBe("loosens");
    expect(d(base, { ...base, rules: [strict] }).after).toEqual(["Billing: files in src/billing/** → always a human"]);
  });
});

describe("finding levels", () => {
  it("custom questions are capped at P1; P0 questions below the high threshold are P1", () => {
    expect(questionLevel({ question: "custom:x", kind: "custom" }, { ...DEFAULT_SEVERITY, questionLevels: { "custom:x": "p0" } })).toBe("p1");
    const f = collectFindings({
      hits: [
        { question: "touchesAuthz", kind: "escalating", p: 0.7, units: ["a#0"] },
        { question: "touchesAuthn", kind: "escalating", p: 0.95, units: ["a#0"] },
        { question: "addressesReviewerOrAutomation", kind: "injection", p: 0.9, units: ["a#0"] },
      ],
      signalsActive: true,
      sensitiveHigh: 0.85,
      severity: { ...DEFAULT_SEVERITY, questionLevels: { addressesReviewerOrAutomation: "p2" } },
      rules: [{ kind: "tests-missing", detail: "x" }],
    });
    expect(f.map((x) => [x.id, x.level])).toEqual([
      ["signal:addressesReviewerOrAutomation", "p0"],
      ["signal:touchesAuthn", "p0"],
      ["rule:tests-missing", "p1"],
      ["signal:touchesAuthz", "p1"],
    ]);
  });
});

// ── End-to-end on fixtures/jev ────────────────────────────────────────────────

const fixture = () =>
  JSON.parse(readFileSync(new URL("../../../../fixtures/jev.json", import.meta.url), "utf8")) as FixtureFile;

async function loadStore(file: ConfigFile = {}) {
  const store = new InMemoryStore();
  await ingestRepo(sourceFromFixtureFile(fixture()), store, { now: NOW });
  await runSignals(store, REPO, new SyntheticSignalModel(), resolveQuestionSet(resolveConfig({ file }).jev), { now: NOW });
  return store;
}

async function planFor(store: InMemoryStore, file: ConfigFile, strip = false) {
  const cfg = resolveConfig({ file });
  const r = await buildReport(store, REPO, cfg.priors, {
    now: NOW,
    jev: cfg.jev.mode === "off" ? undefined : { config: cfg.jev, policy: cfg.policy, qs: resolveQuestionSet(cfg.jev), modelId: "synthetic-v1", calibration: null },
    guardrails: { config: cfg.guardrails, policy: cfg.policy, rules: cfg.rules, severity: cfg.severity },
  });
  // `strip` = the same decisions planned the pre-severity way (no findings).
  const decisions: PullDecision[] = strip ? r.decisions.map(({ findings: _f, scope: _s, ...d }) => d) : [...r.decisions];
  return {
    decisions: r.decisions,
    planned: planReviewActions(decisions, await store.listPulls(REPO), {
      repoId: REPO,
      humanReviewers: ["security-team"],
      authority: MODE_AUTHORITY.full,
      approvalUnlocked: true,
    }),
  };
}

const byPull = (ps: readonly PlannedReviewAction[]) => new Map(ps.map((p) => [p.pullNumber, p.action]));

describe("severity policy on fixtures/jev", () => {
  let store: InMemoryStore;
  beforeAll(async () => {
    store = await loadStore();
  });

  it("defaults reproduce the pre-severity actions (except net-negative, now P1 → ask a human)", async () => {
    for (const mode of ["active", "shadow", "off"] as const) {
      const withSev = await planFor(store, { jev: { mode } });
      const legacy = await planFor(store, { jev: { mode } }, true);
      const a = byPull(withSev.planned);
      const b = byPull(legacy.planned);
      for (const d of withSev.decisions.filter((x) => x.state === "open")) {
        const netNegative = (d.findings ?? []).some((f) => f.kind === "net-negative");
        if (netNegative) {
          expect(a.get(d.pullNumber), `#${d.pullNumber} ${mode}`).toBe("defer_to_human");
        } else {
          expect(a.get(d.pullNumber), `#${d.pullNumber} ${mode}`).toBe(b.get(d.pullNumber));
        }
      }
    }
  });

  it("Observe: signal findings are shown but inactive, so actions match signals off", async () => {
    const shadow = await planFor(store, { jev: { mode: "shadow" } });
    const off = await planFor(store, { jev: { mode: "off" } });
    expect(shadow.decisions.find((d) => d.pullNumber === 1004)!.findings!.some((f) => f.source === "signal" && !f.active)).toBe(true);
    expect([...byPull(shadow.planned)]).toEqual([...byPull(off.planned)]);
  });

  it("signals can't request changes unless opted in; the injection tripwire never can", async () => {
    const strict: ConfigFile = { jev: { mode: "active" }, severity: { actions: { p0: "request-changes", p1: "request-changes" } } };
    const noOpt = byPull((await planFor(store, strict)).planned);
    expect(noOpt.get(1004)).toBe("defer_to_human");
    const opted = await planFor(store, { ...strict, severity: { ...strict.severity, signalsCanRequestChanges: true } });
    const p = opted.planned.find((x) => x.pullNumber === 1004)!;
    expect(p.action).toBe("request_changes");
    expect(p.call.createReview!.body).toMatch(/\*\*P0 · blocking\*\*\n- issue \(blocking\): /);
    expect(p.call.createReview!.body).toMatch(/Touches authn — p=0\.\d+/);
    expect(byPull(opted.planned).get(1002)).toBe("defer_to_human");
  });

  it("P1 → note lets a P1-only PR be approved; P1 → request changes blocks it", async () => {
    const s = await loadStore();
    const base: ConfigFile = { jev: { mode: "active" }, guardrails: { tests: { requireForBehaviorChange: true } } };
    const note = await planFor(s, { ...base, severity: { actions: { p1: "note" } } });
    // PRs a human is already deciding are left alone either way.
    const tests = note.decisions.filter(
      (d) => d.state === "open" && d.lastReviewState === null && (d.findings ?? []).some((f) => f.kind === "tests-missing"),
    );
    expect(tests.length).toBeGreaterThan(0);
    const rc = byPull((await planFor(s, { ...base, severity: { actions: { p1: "request-changes" } } })).planned);
    for (const d of tests) {
      if ((d.findings ?? []).some((f) => f.active && f.level === "p0")) continue;
      expect(rc.get(d.pullNumber), `#${d.pullNumber}`).toBe("request_changes");
      expect(byPull(note.planned).get(d.pullNumber)).not.toBe("request_changes");
    }
  });

  it("a folder rule escalates matching PRs and adds its reviewers", async () => {
    const file: ConfigFile = {
      rules: [{ name: "API", when: { paths: ["src/api/**"] }, set: { requireHuman: true, reviewers: ["api-team"] } }],
    };
    const { planned, decisions } = await planFor(store, file);
    const d = decisions.find((x) => x.pullNumber === 1004)!;
    expect(d.scope!.appliedRules).toEqual([{ name: "API", mode: "stricter" }]);
    const p = planned.find((x) => x.pullNumber === 1004)!;
    expect(p.action).toBe("defer_to_human");
    expect(p.call.requestReviewers!.reviewers).toEqual(["security-team", "api-team"]);
  });
});

describe("rules matched by only some files never add an approval (property)", () => {
  it("random partial-path rules", async () => {
    const store = await loadStore();
    const rand = mulberry32(424242);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
    const base: ConfigFile = { guardrails: { maxAutoApproveLines: 100, maxAutoApproveFiles: 2 }, severity: { actions: { p1: "ask-human" } } };
    const baseApprovals = new Set(
      (await planFor(store, base)).planned.filter((p) => p.action === "approve").map((p) => p.pullNumber),
    );
    for (let i = 0; i < 15; i++) {
      const rules: ReviewRule[] = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, j) => ({
        name: `r${j}`,
        when: { paths: [pick(["src/**", "docs/**", "**/*.md", "src/api/**", "**"])], pathMatch: "any" },
        set: {
          maxLines: pick([null, 1000, 50]),
          maxFiles: pick([null, 50]),
          severity: { p1: pick(["note", "ask-human", "request-changes"] as const) },
          requireTests: pick([false, true]),
        },
      }));
      const approvals = (await planFor(store, { ...base, rules })).planned.filter((p) => p.action === "approve");
      for (const a of approvals) expect(baseApprovals.has(a.pullNumber), `#${a.pullNumber} iteration ${i}`).toBe(true);
    }
  }, 60_000);
});
