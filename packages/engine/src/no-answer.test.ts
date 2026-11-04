import { describe, expect, it } from "vitest";
import { ciRunSchema } from "./ci";
import { checkSeat } from "./council";
import { type ConfigInput, NO_ANSWER_OPTIONS, parseConfig } from "./config";
import { answer, askOutcome, startAsk, tick } from "./no-answer";
import { findQuestions } from "./triggers";

const MIN = 60_000;
const flakyRun = ciRunSchema.parse({ repo: "a/b", headSha: "x", jobs: [{ workflow: "ci", name: "t", attempts: [{ conclusion: "failure", failedTests: ["a"], logExcerpt: "Timeout 5000ms exceeded" }, { conclusion: "success" }] }] });
const sensitiveRun = ciRunSchema.parse({ ...flakyRun, jobs: [{ workflow: "ci", name: "t", attempts: [{ conclusion: "success" }] }], diff: "--- a/src/auth/a.ts\n+++ b/src/auth/a.ts\n@@ -1 +1 @@\n-a = 1\n+a = 2\n" });
const config = (ask: Partial<ConfigInput["ask"]> = {}) => parseConfig({ requiredWorkflows: ["ci"], ask: { to: "sam", backup: "ana", deadlineMinutes: 60, ...ask } });
const seats = (run: typeof flakyRun, verdicts: string[]) => {
  const [question] = findQuestions(run, config());
  return { question: question!, seats: verdicts.map((verdict) => checkSeat({ seat: "s", answer: { verdict, strength: 4, reason: "r", quotes: [] } }, question!, run)) };
};

/** Run the fake clock forward minute by minute, collecting actions. */
function runClock(cfg: ReturnType<typeof config>, run: typeof flakyRun, verdicts: string[], until: number) {
  const { question, seats: checked } = seats(run, verdicts);
  let { state, actions } = startAsk(question, cfg, 0);
  const all = [...actions];
  for (let t = 0; t <= until; t += MIN) {
    const step = tick(state, question, checked, cfg, t);
    state = step.state;
    all.push(...step.actions);
  }
  return { state, actions: all, question };
}

describe("no-answer options at the deadline (fake clock)", () => {
  it("fail: fails with 'no answer from <name>'", () => {
    const { state } = runClock(config({ onNoAnswer: "fail" }), flakyRun, ["pass", "pass", "pass", "needs-person"], 61 * MIN);
    expect(askOutcome(state)).toMatchObject({ outcome: "fail", decidedBy: "no-answer", reason: "No answer from sam." });
    expect(state.noAnswer?.option).toBe("fail");
  });

  it("follow-council: passes when most seats said pass, fails otherwise", () => {
    expect(askOutcome(runClock(config({ onNoAnswer: "follow-council" }), flakyRun, ["pass", "pass", "pass", "needs-person"], 61 * MIN).state).outcome).toBe("pass");
    expect(askOutcome(runClock(config({ onNoAnswer: "follow-council" }), flakyRun, ["pass", "pass", "needs-person", "needs-person"], 61 * MIN).state).outcome).toBe("fail");
  });

  it("follow-council never passes a trigger set to 'a person decides'", () => {
    const { state } = runClock(config({ onNoAnswer: "follow-council" }), sensitiveRun, ["pass", "pass", "pass", "pass"], 61 * MIN);
    expect(askOutcome(state).outcome).toBe("fail");
  });

  it("pass: passes, marked as passed without an answer", () => {
    const { state } = runClock(config({ onNoAnswer: "pass" }), flakyRun, ["needs-person"], 61 * MIN);
    expect(askOutcome(state)).toMatchObject({ outcome: "pass", decidedBy: "no-answer", reason: "Passed without an answer from sam." });
  });

  it("escalate: asks the backup with a fresh deadline, then applies onNoAnswerAfterBackup", () => {
    const cfg = config({ onNoAnswer: "escalate", onNoAnswerAfterBackup: "pass" });
    const halfway = runClock(cfg, flakyRun, ["needs-person"], 90 * MIN);
    expect(halfway.state).toMatchObject({ stage: "backup", asked: ["sam", "ana"], noAnswer: null });
    expect(halfway.actions.map((a) => `${a.kind}:${"to" in a ? a.to : ""}`)).toEqual(["ask:sam", "remind:sam", "ask:ana", "remind:ana"]);
    const done = runClock(cfg, flakyRun, ["needs-person"], 121 * MIN);
    expect(askOutcome(done.state)).toMatchObject({ outcome: "pass", reason: "Passed without an answer from ana." });
  });

  it("nothing happens before the deadline except one reminder at half time", () => {
    const { state, actions } = runClock(config(), flakyRun, ["needs-person"], 59 * MIN);
    expect(askOutcome(state).outcome).toBe("ask");
    expect(actions.filter((a) => a.kind === "remind")).toHaveLength(1);
    expect(runClock(config({ remind: false }), flakyRun, ["needs-person"], 59 * MIN).actions.some((a) => a.kind === "remind")).toBe(false);
  });

  it("a per-trigger option overrides the repo's default", () => {
    const { state } = runClock(config({ onNoAnswer: "pass", perTrigger: { "flaky-test": "fail" } }), flakyRun, ["needs-person"], 61 * MIN);
    expect(askOutcome(state).outcome).toBe("fail");
  });

  it("escalate without a backup is refused", () => {
    expect(() => parseConfig({ requiredWorkflows: ["ci"], ask: { to: "sam", onNoAnswer: "escalate" } })).toThrow(/backup/);
    expect(() => parseConfig({ requiredWorkflows: ["ci"], ask: { to: "sam", perTrigger: { "flaky-test": "escalate" } } })).toThrow(/backup/);
  });
});

describe("answers", () => {
  it("for every no-answer option, a late answer replaces the no-answer outcome", () => {
    for (const onNoAnswer of NO_ANSWER_OPTIONS) {
      const cfg = config({ onNoAnswer, onNoAnswerAfterBackup: "fail" });
      const { state } = runClock(cfg, flakyRun, ["pass", "pass", "pass", "pass"], 200 * MIN);
      expect(state.noAnswer, onNoAnswer).not.toBeNull();
      const late = state.noAnswer!.outcome === "pass" ? "fail" : "pass";
      const result = answer(state, { value: late, by: "sam", isAdmin: false }, 201 * MIN);
      expect(result.accepted, onNoAnswer).toBe(true);
      expect(askOutcome(result.state), onNoAnswer).toMatchObject({ outcome: late, decidedBy: "person" });
    }
  });

  it("the first answer wins, and only people asked or a repo admin may answer", () => {
    const { question } = seats(flakyRun, []);
    const { state } = startAsk(question, config(), 0);
    expect(answer(state, { value: "pass", by: "mallory", isAdmin: false }, 1)).toMatchObject({ accepted: false });
    const first = answer(state, { value: "pass", by: "sam", isAdmin: false }, 1);
    expect(first.actions).toEqual([{ kind: "cancel-other-channels" }]);
    const second = answer(first.state, { value: "fail", by: "admin", isAdmin: true }, 2);
    expect(second).toMatchObject({ accepted: false, why: "Already answered by sam." });
    expect(askOutcome(second.state).outcome).toBe("pass");
  });

  it("after escalation the first person asked may still answer", () => {
    const { state } = runClock(config({ onNoAnswer: "escalate" }), flakyRun, ["needs-person"], 61 * MIN);
    expect(answer(state, { value: "fail", by: "sam", isAdmin: false }, 62 * MIN).accepted).toBe(true);
  });

  it("an answer stops the clock: no reminder and no no-answer outcome later", () => {
    const { question, seats: checked } = seats(flakyRun, ["needs-person"]);
    const answered = answer(startAsk(question, config(), 0).state, { value: "pass", by: "sam", isAdmin: false }, MIN).state;
    expect(tick(answered, question, checked, config(), 500 * MIN)).toEqual({ state: answered, actions: [] });
  });
});
