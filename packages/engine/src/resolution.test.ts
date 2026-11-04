import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ciRunSchema } from "./ci";
import { checkSeat } from "./council";
import { parseConfig } from "./config";
import { loadFixtures } from "./fixtures";
import { decideRun, resolveQuestion } from "./resolution";
import { fixedCouncil, randomCouncil, seeded } from "./testing";
import { findQuestions } from "./triggers";

const fixtures = loadFixtures(fileURLToPath(new URL("../../../fixtures", import.meta.url)));
const PASS = { verdict: "pass", strength: 5, reason: "fine", quotes: [] };

describe("rules that must never break, over every fixture", () => {
  it("a hard failure always fails, and no council call is made", async () => {
    for (const f of fixtures.filter((x) => x.expect.hardFailure)) {
      const council = fixedCouncil(PASS);
      expect((await decideRun(f.run, f.config, council)).result, f.name).toBe("fail");
      expect(council.calls, f.name).toBe(0);
    }
  });

  it("no trigger fired → pass, and no council call is made", async () => {
    for (const f of fixtures.filter((x) => !x.expect.hardFailure && x.expect.triggers.length === 0)) {
      const council = fixedCouncil({ verdict: "fail", strength: 5, reason: "x", quotes: [] });
      expect((await decideRun(f.run, f.config, council)).result, f.name).toBe("pass");
      expect(council.calls, f.name).toBe(0);
    }
  });

  it("whatever the council says: a person-decides trigger is never passed by it, and a fail without a valid quote never fails", async () => {
    const random = seeded(42);
    const seen = new Set<string>();
    for (const f of fixtures.filter((x) => !x.expect.hardFailure && x.expect.triggers.length > 0)) {
      for (const needsPersonBlocksPass of [true, false]) {
        const config = { ...f.config, council: { ...f.config.council, needsPersonBlocksPass } };
        for (let i = 0; i < 150; i++) {
          const decision = await decideRun(f.run, config, randomCouncil(random));
          for (const q of decision.questions) {
            seen.add(`${q.question.councilMayPass}:${q.outcome}`);
            if (!q.question.councilMayPass) expect(q.outcome, f.name).not.toBe("pass");
            if (q.outcome === "fail") expect(q.seats.some((s) => s.verdict === "fail" && s.validQuotes.length > 0), f.name).toBe(true);
            if (q.outcome === "pass") expect(q.seats.some((s) => s.verdict === "fail"), f.name).toBe(false);
          }
          expect(decision.councilCalls).toBe(decision.questions.length * config.council.seats.length);
        }
      }
    }
    // The random council really reached every outcome, so the checks above were not empty.
    for (const outcome of ["true:pass", "true:fail", "true:ask", "false:fail", "false:ask"]) expect(seen).toContain(outcome);
  });
});

describe("council answers", () => {
  const f = fixtures.find((x) => x.name === "weakened-skip")!;
  const [question] = findQuestions(f.run, f.config);

  it("accepts a fail whose quote is a changed line, ignoring spacing", () => {
    const seat = checkSeat({ seat: "s", answer: { verdict: "fail", strength: 4, reason: "skipped", quotes: [{ source: "diff", text: "it.skip('rounds   totals to cents'" }] } }, question!, f.run);
    expect(seat).toMatchObject({ verdict: "fail", problems: [] });
  });

  it("downgrades a fail quoting an unchanged line, a made-up line, a too-short quote, or the wrong source", () => {
    for (const quote of [
      { source: "diff", text: "expect(total([{ price: 0.1, qty: 3 }])).toBe(0.3);" }, // context line
      { source: "diff", text: "this line is not in the diff" },
      { source: "diff", text: "skip" },
      { source: "log", text: "it.skip('rounds totals to cents'" },
    ]) {
      const seat = checkSeat({ seat: "s", answer: { verdict: "fail", strength: 5, reason: "x", quotes: [quote] } }, question!, f.run);
      expect(seat.verdict, quote.text).toBe("needs-person");
    }
  });

  it("a malformed answer or a failed call counts as needs-person", () => {
    for (const raw of [
      { seat: "s", answer: { verdict: "pass", strength: 7, reason: "x", quotes: [] } },
      { seat: "s", answer: { verdict: "approve", strength: 4, reason: "x", quotes: [] } },
      { seat: "s", answer: "pass" },
      { seat: "s", answer: null, error: "429 daily limit reached" },
    ]) {
      expect(checkSeat(raw, question!, f.run).verdict).toBe("needs-person");
    }
  });
});

describe("resolution rule", () => {
  const run = ciRunSchema.parse({ repo: "a/b", headSha: "x", jobs: [{ workflow: "ci", name: "t", attempts: [{ conclusion: "failure", failedTests: ["a"], logExcerpt: "Timeout 5000ms exceeded" }, { conclusion: "success" }] }] });
  const config = parseConfig({ requiredWorkflows: ["ci"] });
  const [question] = findQuestions(run, config);
  const seat = (verdict: string, strength = 5) => checkSeat({ seat: "s", answer: { verdict, strength, reason: "r", quotes: verdict === "fail" ? [{ source: "log", text: "Timeout 5000ms" }] : [] } }, question!, run);

  it("all strong passes → pass; one weak pass or one needs-person → ask; one valid fail → fail", () => {
    expect(resolveQuestion(question!, [seat("pass"), seat("pass"), seat("pass"), seat("pass")], config).outcome).toBe("pass");
    expect(resolveQuestion(question!, [seat("pass"), seat("pass"), seat("pass"), seat("pass", 3)], config).outcome).toBe("ask");
    expect(resolveQuestion(question!, [seat("pass"), seat("pass"), seat("pass"), seat("needs-person")], config).outcome).toBe("ask");
    expect(resolveQuestion(question!, [seat("pass"), seat("pass"), seat("pass"), seat("fail")], config).outcome).toBe("fail");
    expect(resolveQuestion(question!, [], config).outcome).toBe("ask");
  });

  it("with needsPersonBlocksPass off, a strong majority passes but any fail still stops it", () => {
    const loose = parseConfig({ requiredWorkflows: ["ci"], council: { needsPersonBlocksPass: false } });
    expect(resolveQuestion(question!, [seat("pass"), seat("pass"), seat("pass"), seat("needs-person")], loose).outcome).toBe("pass");
    expect(resolveQuestion(question!, [seat("pass"), seat("pass"), seat("needs-person"), seat("needs-person")], loose).outcome).toBe("ask");
  });

  it("a person's answer decides, and the run waits while a question is open", async () => {
    const asking = fixedCouncil({ verdict: "needs-person", strength: 3, reason: "unsure", quotes: [] });
    expect((await decideRun(run, config, asking)).result).toBe("waiting");
    expect((await decideRun(run, config, asking, { "flaky-test": "fail" })).result).toBe("fail");
    expect((await decideRun(run, config, asking, { "flaky-test": "pass" })).result).toBe("pass");
  });
});
