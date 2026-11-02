import { describe, expect, it } from "vitest";
import { calibrate } from "./calibration.js";
import type { CaseInput, DecideContext } from "./decide.js";
import { carryOut, decideCase, recordDecision } from "./decide.js";
import { MemoryEvidenceStore, verifyChain } from "./evidence.js";
import { CLAIM_FEATURES, CLAIM_REASONS, claimCosts, claimFeatures, generateClaims } from "./examples/insurance-claims.js";
import { MemoryNonceLedger } from "./permit.js";
import { typicalValues } from "./reasons.js";

const now = "2026-10-31T12:00:00.000Z";
const history = generateClaims({ count: 3000, seed: 11 });
const model = calibrate(history, CLAIM_FEATURES, { scope: "p", now });
const key = "k";

const ctx = (over: Partial<DecideContext> = {}): DecideContext => ({
  model,
  authority: {
    profile: "act-within-limits",
    limits: { maxActAmount: 2500 },
    agentStatus: "approved",
    stop: { stopped: false, reason: "" },
    fairnessGatePassed: true,
    delivery: "live",
    permitKey: true,
  },
  agent: { id: "a", version: "1" },
  configHash: "c",
  permitKey: key,
  reasonTable: CLAIM_REASONS,
  typical: typicalValues(history, CLAIM_FEATURES.map((f) => f.name)),
  now,
  ...over,
});

const claim = (over: Partial<Parameters<typeof claimFeatures>[0]> = {}, extra: Partial<CaseInput> = {}): CaseInput => {
  const c = { amount: 380, daysSincePolicyStart: 400, priorClaims: 0, documentsMissing: 0, bodilyInjury: false, coverage: "auto-glass" as const, ...over };
  return { id: "C1", scope: "p", amount: c.amount, features: claimFeatures(c), costs: claimCosts(c.amount), ...extra };
};

const send = async (call: { caseId: string }) => ({ ref: `ref:${call.caseId}` });

describe("decideCase + carryOut", () => {
  it("auto-approves a small clean claim and sends it once with a valid permit", async () => {
    const d = decideCase(claim(), ctx());
    expect(d.recommendation).toBe("approve");
    expect(d.authorization.effective).toBe("act");
    const store = new MemoryEvidenceStore();
    const ledger = new MemoryNonceLedger();
    await recordDecision(store, d, now);
    expect((await carryOut(d, { delivery: "live", key, ledger, store, send, now })).status).toBe("sent");
    expect((await carryOut(d, { delivery: "live", key, ledger, store, send, now })).detail).toBe("permit was already used");
    const rows = await store.list("p");
    expect(rows.map((r) => r.kind)).toEqual(["decision", "authorization", "permit-issued", "sent", "blocked"]);
    expect(verifyChain(rows).ok).toBe(true);
  });

  it("blocks a call that was changed after the permit was issued, and an expired permit", async () => {
    const d = decideCase(claim(), ctx());
    const store = new MemoryEvidenceStore();
    const tampered = { ...d, call: { ...d.call!, amount: 99999 } };
    expect((await carryOut(tampered, { delivery: "live", key, ledger: new MemoryNonceLedger(), store, send, now })).detail).toBe("permit does not cover this call");
    const later = "2026-10-31T12:06:00.000Z";
    expect((await carryOut(d, { delivery: "live", key, ledger: new MemoryNonceLedger(), store, send, now: later })).detail).toContain("expired");
  });

  it("refers a risky claim with plain-language reasons", () => {
    const d = decideCase(claim({ amount: 7800, daysSincePolicyStart: 5, documentsMissing: 2, coverage: "property-water" }), ctx());
    expect(d.recommendation).toBe("refer");
    expect(d.authorization.effective).toBe("route-to-person");
    expect(d.reasons.map((r) => r.text)).toContain(CLAIM_REASONS.earlyClaim);
  });

  it("an AI fraud signal can only push toward a person", () => {
    const clean = decideCase(claim(), ctx());
    const flagged = decideCase(claim({}, { signals: [{ name: "possibleFraud", probability: 0.7 }] }), ctx());
    expect(flagged.risk!).toBeGreaterThan(clean.risk!);
    expect(flagged.recommendation).toBe("refer");
  });

  it("sends an adverse finding to a person, never acts on it", () => {
    const d = decideCase(claim({}, { adverse: { reasons: ["Exclusion 4.2 may apply."] } }), ctx());
    expect(d.recommendation).toBe("adverse");
    expect(d.authorization.effective).toBe("route-to-person");
    expect(d.reasons[0]!.text).toBe("Exclusion 4.2 may apply.");
  });

  it("refers everything without a usable model", () => {
    const d = decideCase(claim(), ctx({ model: null }));
    expect(d.recommendation).toBe("refer");
    expect(d.risk).toBeNull();
  });

  it("log delivery issues no permit and sends nothing", async () => {
    const c = ctx();
    const d = decideCase(claim(), { ...c, authority: { ...c.authority, delivery: "log" } });
    expect(d.permit).toBeNull();
    expect((await carryOut(d, { delivery: "log", key, ledger: new MemoryNonceLedger(), store: new MemoryEvidenceStore(), send, now })).status).toBe("logged");
  });
});

describe("verifyChain", () => {
  it("detects an edited row and a missing row", async () => {
    const store = new MemoryEvidenceStore();
    await recordDecision(store, decideCase(claim(), ctx()), now);
    const rows = await store.list("p");
    const edited = rows.map((r, i) => (i === 1 ? { ...r, payload: { changed: true } } : r));
    expect(verifyChain(edited).ok).toBe(false);
    expect(verifyChain([rows[0]!, rows[2]!]).breaks.some((b) => b.problem.includes("missing"))).toBe(true);
  });
});
