import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";
import { loadFixtures } from "./fixtures";
import { decideRun } from "./resolution";
import type { Screener } from "./screens";
import { fixedCouncil } from "./testing";

/**
 * The eight labeled cases of the inert check's step-0 test (code/pullup scripts/inert-lint-test),
 * as fixtures. Code alone must disprove the four it can (a shared function changed with no flag,
 * new code under a negated gate, a startup side effect, a flag turned on) whatever the model says,
 * and must not disprove the kill switch. The rest depends on the screens.
 */

const fixtures = loadFixtures(fileURLToPath(new URL("../../../fixtures", import.meta.url))).filter((f) => f.name.startsWith("inert-"));
const PASS = { verdict: "pass", strength: 5, reason: "", quotes: [] };
const status = async (name: string, screener: Screener | null) => {
  const f = fixtures.find((x) => x.name === `inert-${name}`)!;
  const d = await decideRun(f.run, f.config, fixedCouncil(PASS), { now: 0, screener });
  return (d.extensions!.facts.find((x) => x.kind === "inert") as unknown as { status: string }).status;
};
/** A model that says nothing differs, every time. */
const saysNo: Screener = async (s) => ({ seat: s.id, answer: { result: "no", confidence: 0.95, reason: "only behind the flag", quotes: [] } });

describe("the inert check on the step-0 cases", () => {
  it("has all eight cases", () => {
    expect(fixtures).toHaveLength(8);
  });

  it("code alone disproves what it can, even when the model says nothing differs", async () => {
    for (const name of ["leak-shared-tax", "inverted-check", "startup-side-effect", "flag-default-on"]) {
      expect(await status(name, saysNo), name).toBe("disproved");
      expect(await status(name, null), name).toBe("disproved");
    }
  });

  it("with no screen service, nothing is verified: the claim stays unclear", async () => {
    for (const name of ["inert-gated-discount", "inert-gated-route-handler", "inert-kill-switch", "data-backfill"]) expect(await status(name, null), name).toBe("unclear");
  });

  it("the gated cases, including the kill switch, are verified when the screens agree; data-backfill only falls to the model", async () => {
    for (const name of ["inert-gated-discount", "inert-gated-route-handler", "inert-kill-switch", "data-backfill"]) expect(await status(name, saysNo), name).toBe("verified");
    const saysYes: Screener = async (s) => ({ seat: s.id, answer: { result: "yes", confidence: 0.9, reason: "writes users regardless of the flag", quotes: [{ text: 'await db.update("users", { id: userId }, { lastOrderCents: cents });' }] } });
    expect(await status("data-backfill", saysYes)).toBe("disproved");
  });

  it("a verified claim relaxes the sensitive path question only when the repository allows it", async () => {
    const f = fixtures.find((x) => x.name === "inert-inert-kill-switch")!;
    // The same change, in a payments folder so core's sensitive path check fires.
    const run = { ...f.run, diff: f.run.diff.replaceAll("src/checkout.ts", "src/payments/checkout.ts") };
    for (const allow of [false, true]) {
      const config = parseConfig({ requiredWorkflows: ["ci"], ask: { to: "a@example.com" }, extensions: { inert: { mode: "active", relaxSensitiveWhenInert: allow } } });
      const d = await decideRun(run, config, fixedCouncil(PASS), { now: 0, screener: saysNo });
      expect(d.questions.map((q) => [q.question.id, q.outcome]), String(allow)).toEqual([["core:sensitive-path", allow ? "pass" : "ask"]]);
      expect(d.extensions!.relaxations[0]).toMatchObject({ applied: allow, refused: allow ? null : "the setting inert.relaxSensitiveWhenInert is off" });
    }
  });

  it("turning a flag on is a question only a person may pass, with or without a claim, and never relaxed", async () => {
    const f = fixtures.find((x) => x.name === "inert-flag-default-on")!;
    const config = parseConfig({ requiredWorkflows: ["ci"], ask: { to: "a@example.com" }, extensions: { inert: { mode: "active", relaxSensitiveWhenInert: true } } });
    const d = await decideRun({ ...f.run, pull: null }, config, fixedCouncil(PASS), { now: 0, screener: saysNo });
    expect(d.questions.map((q) => [q.question.id, q.question.councilMayPass, q.outcome])).toEqual([["inert:flag-activation", false, "ask"]]);
  });
});
