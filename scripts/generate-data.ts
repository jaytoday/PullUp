import { mkdirSync, writeFileSync } from "node:fs";
import { assessInput, ciRunSchema, detectConcerns, parseConfig } from "@pullup/engine";
import { generatePulls, SYNTHETIC_CONFIG } from "./synthetic";

/**
 * Writes the synthetic data (`pnpm generate-data`):
 * - data/synthetic/pulls.jsonl: whole pull requests with CI results, for the demo;
 * - askwithai/tests/cases.jsonl: one labeled case per concern, in the runtime's
 *   input format, for AskWithAI's benchmark and release gates.
 * Every case is checked: the detectors must find exactly the concerns the
 * generator labeled, or the script stops.
 */

const pulls = generatePulls();
const config = parseConfig(SYNTHETIC_CONFIG);
const cases: unknown[] = [];
for (const p of pulls) {
  const run = ciRunSchema.parse(p.run);
  const found = detectConcerns(run, config);
  const want = Object.keys(p.truth).sort();
  const got = found.map((c) => c.concern).sort();
  if (JSON.stringify(want) !== JSON.stringify(got)) throw new Error(`${p.id}: labeled ${want.join(",")} but detected ${got.join(",")}`);
  for (const c of found) cases.push({ id: `${p.id}:${c.concern}`, input: assessInput(c, run), labels: { merge_risk: p.truth[c.concern] }, split: p.split, evidence: "uploaded", synthetic: true, reason: p.reason[c.concern] ?? null });
}
mkdirSync("data/synthetic", { recursive: true });
mkdirSync("askwithai/tests", { recursive: true });
writeFileSync("data/synthetic/pulls.jsonl", `${pulls.map((p) => JSON.stringify(p)).join("\n")}\n`);
writeFileSync("askwithai/tests/cases.jsonl", `${cases.map((c) => JSON.stringify(c)).join("\n")}\n`);
const risky = cases.filter((c) => (c as { labels: { merge_risk: string } }).labels.merge_risk === "risky").length;
const by = (s: string) => cases.filter((c) => (c as { split: string }).split === s).length;
console.log(`${pulls.length} synthetic pull requests, ${cases.length} labeled concern cases (${risky} risky, ${cases.length - risky} safe; tune ${by("tune")}, holdout ${by("holdout")}, hard ${by("hard")}).`);
