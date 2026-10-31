// Runs the control layer on synthetic insurance claims: calibrate a risk
// model on past claims, check it for fairness, decide a handful of new claims,
// carry them out with permits, and verify the evidence chain.
//
//   pnpm control:demo            fair synthetic data
//   pnpm control:demo --skewed   group B is more often missing documents

import {
  CLAIM_FEATURES,
  CLAIM_REASONS,
  MemoryEvidenceStore,
  MemoryNonceLedger,
  calibrate,
  carryOut,
  claimCosts,
  claimFeatures,
  decideCase,
  fairnessReport,
  generateClaims,
  recordDecision,
  typicalValues,
  verifyChain,
  type CaseInput,
} from "@pullup/control";

const skewed = process.argv.includes("--skewed");
const now = "2026-10-31T12:00:00.000Z";
const history = generateClaims({ count: 3000, seed: 11, skewGroupB: skewed });

const model = calibrate(history, CLAIM_FEATURES, { scope: "personal-auto-and-home", now });
console.log("Calibration on", model.labelled.cases, "past claims,", model.labelled.positives, "bad outcomes");
console.log("  AUROC", model.metrics.auroc, "· calibration error", model.metrics.ece, "· risk gate", model.gate.passed ? "passed" : "failed");
console.log("  auto-path", model.autoPath, "· auto gate", model.autoGate.passed ? "passed" : "failed");
for (const c of [...model.gate.checks, ...model.autoGate.checks]) console.log(`    ${c.passed ? "ok  " : "FAIL"} ${c.name}: ${c.value} (needs ${c.threshold})`);

const fairness = fairnessReport(
  history.map((c) => ({ group: c.group, risk: model.predictions[c.id]!, bad: c.bad })),
  { favorableMaxRisk: 0.05 },
);
console.log("Fairness:", fairness.gate.passed ? "passed" : "failed", "· impact ratio", fairness.impactRatio, "· calibration gap", fairness.calibrationGap);
for (const g of fairness.groups) console.log(`    group ${g.group}: n=${g.n} auto-eligible ${g.favorableRate} bad ${g.badRate}`);

const key = "demo-permit-key";
const store = new MemoryEvidenceStore();
const ledger = new MemoryNonceLedger();
const typical = typicalValues(history, CLAIM_FEATURES.map((f) => f.name));

const incoming: CaseInput[] = [
  { label: "windshield, clean file", amount: 380, days: 400, prior: 0, missing: 0, injury: false, coverage: "auto-glass" as const },
  { label: "water damage, 12 days after start", amount: 7800, days: 12, prior: 1, missing: 1, injury: false, coverage: "property-water" as const },
  { label: "theft, AI flagged possible fraud", amount: 1900, days: 300, prior: 0, missing: 0, injury: false, coverage: "property-theft" as const, fraud: 0.6 },
  { label: "collision with injury", amount: 4100, days: 200, prior: 0, missing: 0, injury: true, coverage: "auto-collision" as const },
  { label: "collision, exclusion found", amount: 2600, days: 500, prior: 0, missing: 0, injury: false, coverage: "auto-collision" as const, exclusion: true },
].map((c, i) => ({
  id: `NEW-${i + 1} (${c.label})`,
  scope: "personal-auto-and-home",
  amount: c.amount,
  features: claimFeatures({ amount: c.amount, daysSincePolicyStart: c.days, priorClaims: c.prior, documentsMissing: c.missing, bodilyInjury: c.injury, coverage: c.coverage }),
  signals: "fraud" in c ? [{ name: "possibleFraud", probability: c.fraud!, reason: CLAIM_REASONS.possibleFraud }] : [],
  costs: claimCosts(c.amount),
  adverse: "exclusion" in c ? { reasons: ["The policy's wear-and-tear exclusion appears to apply (section 4.2)."] } : undefined,
}));

console.log("\nNew claims:");
for (const input of incoming) {
  const d = decideCase(input, {
    model,
    authority: {
      profile: "act-within-limits",
      limits: { maxActAmount: 2500 },
      agentStatus: "approved",
      stop: { stopped: false, reason: "" },
      fairnessGatePassed: fairness.gate.passed,
      delivery: "live",
      permitKey: true,
    },
    agent: { id: "claims-triage", version: "2026.10.31" },
    configHash: "demo",
    permitKey: key,
    reasonTable: CLAIM_REASONS,
    typical,
    now,
  });
  await recordDecision(store, d, now);
  const result = await carryOut(d, { delivery: "live", key, ledger, store, now, send: async (call) => ({ ref: `${call.effect}:${call.caseId}` }) });
  console.log(`  ${d.caseId}`);
  console.log(`    risk ${d.risk} · review costs ${d.cost?.reviewCost} vs expected loss ${d.cost?.expectedLossIfActed} → ${d.recommendation}`);
  console.log(`    authorization ${d.authorization.decision}: ${d.authorization.effective} — ${d.authorization.reasons.join(" ")}`);
  if (d.reasons.length) console.log(`    reasons: ${d.reasons.map((r) => r.text).join(" | ")}`);
  console.log(`    result: ${result.status}`);
}

const rows = await store.list("personal-auto-and-home");
const check = verifyChain(rows);
console.log(`\nEvidence: ${rows.length} rows, chain ${check.ok ? "intact" : "BROKEN"}`);
