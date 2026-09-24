import { describe, expect, it } from "vitest";
import type { HunkRecord } from "../schema/domain.js";
import { evaluatePolicy } from "../policy/policy.js";
import type { PullSignals } from "./aggregate.js";
import { assessPull, extractFeatures, riskFromFeatures } from "./aggregate.js";
import { DEFAULT_JEV_CONFIG, DEFAULT_RISK_WEIGHTS } from "./config.js";
import { hunkContentHash } from "./hunks.js";
import { QUESTION_SET_V1 as QS } from "./questions/v1.js";
import type { Answer, UnitAnswers } from "./types.js";
import { buildUnits } from "./units.js";

/** Answers with every noul at `p` unless overridden. */
function answers(overrides: Record<string, number> = {}, kind = "feature", p = 0.02): UnitAnswers {
  const a: Record<string, Answer> = {};
  for (const [id, spec] of Object.entries(QS.questions)) {
    if (spec.kind === "noul") a[id] = { kind: "noul", p: overrides[id] ?? p };
    else if (spec.kind === "choice") a[id] = { kind: "choice", choice: kind, confidence: 0.95, probabilities: { [kind]: 0.95 } };
    else a[id] = { kind: "score", score: 1, confidence: 0.8, probabilities: { "1": 0.8 } };
  }
  return { answers: a, modelId: "test", inputTokens: 100, latencyMs: 0 };
}

function signals(path: string, a: UnitAnswers | null): PullSignals {
  const h = { path, header: "@@ -1 +1 @@", patch: "+x", noPatch: false };
  const rec: HunkRecord = { repoId: "o/r", pullNumber: 1, index: 0, ...h, contentHash: hunkContentHash(h) };
  return { pullNumber: 1, units: buildUnits([rec], QS, { area: "app" }), answers: [a] };
}

function assess(path: string, a: UnitAnswers | null, calibrated = false) {
  return assessPull({
    pull: { number: 1, files: [path] },
    policy: evaluatePolicy([path]),
    signals: signals(path, a),
    qs: QS,
    config: DEFAULT_JEV_CONFIG,
    weights: DEFAULT_RISK_WEIGHTS,
    calibrated,
    baseDefectProbability: 0.05,
  });
}

describe("assessPull bands", () => {
  it("escalates on a policy hit even with all-zero signals", () => {
    const r = assess(".github/workflows/ci.yml", answers({}, "other", 0));
    expect(r.band).toBe("escalate");
    expect(r.escalateReasons[0]).toMatch(/policy/);
    expect(r.fastPathEligible).toBe(false);
  });

  it("escalates on a high escalating signal, reviews on a medium one", () => {
    expect(assess("src/a.ts", answers({ touchesAuthz: 0.9 })).band).toBe("escalate");
    expect(assess("src/a.ts", answers({ touchesAuthz: 0.6 })).band).toBe("review-with-rationale");
    // A non-escalating sensitive signal never escalates on its own.
    expect(assess("src/a.ts", answers({ changesDependencyManifest: 0.99 })).band).toBe("review-with-rationale");
  });

  it("escalates on the injection tripwire even when it suppressed the other signals", () => {
    const r = assess("src/a.ts", answers({ addressesReviewerOrAutomation: 0.9, touchesAuthz: 0.4 }));
    expect(r.band).toBe("escalate");
    expect(r.fastPathEligible).toBe(false);
  });

  it("fast-path needs allowlisted path + low signals + low-risk change kind", () => {
    expect(assess("docs/a.md", answers({}, "docs")).band).toBe("fast-path");
    expect(assess("docs/a.md", answers({}, "feature")).fastPathEligible).toBe(false);
    expect(assess("docs/a.md", answers({ addsNetworkCall: 0.2 }, "docs")).fastPathEligible).toBe(false);
    expect(assess("src/a.ts", answers({}, "docs")).fastPathEligible).toBe(false);
    // Formatting evidence can qualify outside the path allowlist.
    expect(assess("src/a.ts", answers({ isFormattingOnly: 0.95 }, "formatting")).band).toBe("fast-path");
  });

  it("an unevaluated unit is unknown risk: review band, never fast path", () => {
    const r = assess("docs/a.md", null);
    expect(r.band).toBe("review-with-rationale");
    expect(r.fastPathEligible).toBe(false);
    expect(r.risk).toBeNull();
  });
});

describe("asymmetric authority", () => {
  it("never applies m < 1, and applies m > 1 only when calibrated", () => {
    const low = assess("docs/a.md", answers({ isDocsOrCommentsOnly: 0.97 }, "docs"), true);
    expect(low.unclampedMultiplier!).toBeLessThan(1);
    expect(low.multiplier).toBe(1);
    const high = assess("src/a.ts", answers({ handlesSecrets: 0.99, touchesAuthn: 0.99 }), true);
    expect(high.multiplier).toBeGreaterThan(1);
    const uncal = assess("src/a.ts", answers({ handlesSecrets: 0.99, touchesAuthn: 0.99 }), false);
    expect(uncal.multiplier).toBe(1);
  });

  it("negative weights on risk features are clamped: raising a signal never lowers risk", () => {
    const weights = { intercept: -3, features: { "max:touchesAuthn": -5, blastMax: -2, lowRiskMin: -1 } };
    const f = extractFeatures(signals("src/a.ts", answers()), QS)!;
    const raised = { ...f, "max:touchesAuthn": 0.99, blastMax: 1 };
    expect(riskFromFeatures(raised, weights)).toBeGreaterThanOrEqual(riskFromFeatures(f, weights));
  });
});
