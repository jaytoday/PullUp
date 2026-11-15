import { describe, expect, it } from "vitest";
import { checkRunView } from "./check-run";
import { ciRunSchema } from "./ci";
import { decideRun } from "./policy";
import { quoteChecksOut } from "./quotes";
import { assessment, seeded } from "./testing";

/**
 * The fixed rule: code decides from the typed answers. A `risky` answer fails
 * only with a quote that checks out; anything unsure waits for a person; and
 * Enforce mode never passes on simulated answers.
 */

const run = ciRunSchema.parse({
  repo: "acme/shop",
  headSha: "abc",
  diff: "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,1 +1,1 @@\n-const TTL = 3600;\n+const TTL = 86400 * 30;\n",
  jobs: [{ workflow: "ci", name: "test", attempts: [{ conclusion: "failure", logExcerpt: "Error: socket hang up in session.spec.ts" }, { conclusion: "success" }] }],
});

describe("quote check", () => {
  it("accepts changed diff lines (with or without the +) and log text, refuses context, made-up and short quotes", () => {
    expect(quoteChecksOut({ quote: "+const TTL = 86400 * 30;" }, run)).toBe(true);
    expect(quoteChecksOut({ quote: "const   TTL = 3600;" }, run)).toBe(true);
    expect(quoteChecksOut({ quote: "socket hang up" }, run)).toBe(true);
    expect(quoteChecksOut({ quote: "DROP TABLE users" }, run)).toBe(false);
    expect(quoteChecksOut({ quote: "TTL" }, run)).toBe(false);
  });
});

describe("decideRun", () => {
  const risky = (verified: boolean) => assessment("sensitive_change", { answer: "risky", citations: [{ quote: "x" }], verified: verified ? [{ quote: "const TTL = 86400 * 30;" }] : [] });

  it("a hard failure fails with no concern looked at", () => {
    const d = decideRun([{ workflow: "ci", job: "test", reason: "test failed.", logExcerpt: "" }], [assessment("flaky_retry")], "enforce");
    expect(d).toMatchObject({ result: "fail", concerns: [] });
  });
  it("passes when nothing is tricky or every concern is safe", () => {
    expect(decideRun([], [], "enforce").result).toBe("pass");
    expect(decideRun([], [assessment("flaky_retry"), assessment("deleted_tests")], "enforce").result).toBe("pass");
  });
  it("risky with a checked quote fails; risky without one waits for a person", () => {
    expect(decideRun([], [risky(true)], "enforce").result).toBe("fail");
    expect(decideRun([], [risky(false)], "enforce")).toMatchObject({ result: "waiting", concerns: [{ outcome: "waiting", reason: /no quote checked out/ }] });
  });
  it("pending reviews, missing facts and failed calls wait; fail beats waiting", () => {
    expect(decideRun([], [assessment("flaky_retry", { status: "pending_review", final: false })], "enforce").result).toBe("waiting");
    expect(decideRun([], [assessment("flaky_retry", { status: "input_required", final: false, answer: null })], "enforce").result).toBe("waiting");
    expect(decideRun([], [assessment("flaky_retry", { status: "failed", answer: null, error: "timeout" })], "enforce").result).toBe("waiting");
    expect(decideRun([], [assessment("flaky_retry", { status: "failed", answer: null }), risky(true)], "enforce").result).toBe("fail");
  });
  it("Enforce mode never passes on simulated answers; Report only shows what it would do", () => {
    expect(decideRun([], [assessment("flaky_retry", { synthetic: true })], "enforce").result).toBe("waiting");
    expect(decideRun([], [assessment("flaky_retry", { synthetic: true })], "report_only").result).toBe("pass");
  });
  it("whatever the answers, a pass never contains a risky or unsure concern (random answers)", () => {
    const random = seeded(7);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]!;
    for (let i = 0; i < 500; i++) {
      const list = (["flaky_retry", "deleted_tests", "sensitive_change"] as const).filter(() => random() < 0.6).map((c) =>
        assessment(c, { answer: pick(["risky", "safe", null] as const), final: random() < 0.8, status: pick(["decided", "pending_review", "failed"] as const), synthetic: random() < 0.3, verified: random() < 0.5 ? [{ quote: "q" }] : [] }),
      );
      const d = decideRun([], list, "enforce");
      if (d.result === "pass") for (const a of list) expect(a).toMatchObject({ answer: "safe", final: true, synthetic: false });
    }
  });
});

describe("check run view", () => {
  it("Report only is always neutral; Enforce maps the result; waiting stays in progress", () => {
    const wait = decideRun([], [assessment("flaky_retry", { status: "pending_review", final: false })], "enforce");
    expect(checkRunView(wait, [], "report_only")).toMatchObject({ status: "completed", conclusion: "neutral", title: "Report only: would wait for a person" });
    expect(checkRunView(wait, [], "enforce")).toMatchObject({ status: "in_progress", conclusion: null });
    const a = [assessment("sensitive_change", { answer: "risky", verified: [{ quote: "const TTL = 86400 * 30;" }], synthetic: true, decisionId: "dec_1" })];
    const view = checkRunView(decideRun([], a, "report_only"), a, "enforce");
    expect(view).toMatchObject({ conclusion: "failure", title: "Failed" });
    expect(view.summary).toContain("simulated");
    expect(view.summary).toContain("dec_1");
  });
});
