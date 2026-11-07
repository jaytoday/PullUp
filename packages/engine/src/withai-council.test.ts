import { fileURLToPath } from "node:url";
import type { ApplyInput, ApplyResult } from "@withai/client";
import { WithAIError } from "@withai/client";
import { describe, expect, it } from "vitest";
import { loadFixtures } from "./fixtures";
import { type CheckedSeat, seatOutcomes } from "./council";
import { decideRun } from "./resolution";
import { type ApplyClient, COUNCIL_PROFILE, MAX_DIFF_CHARS, type Recording, recordingCouncil, replayCouncil, withaiCouncil } from "./withai-council";

const fixtures = loadFixtures(fileURLToPath(new URL("../../../fixtures", import.meta.url)));
const fixture = (name: string) => fixtures.find((f) => f.name === name)!;
const wrap = (value: Record<string, unknown>) => ({ answer: { type: "schema" as const, value } });

function fakeClient(reply: (input: ApplyInput) => Partial<ApplyResult> | Error): ApplyClient & { inputs: ApplyInput[] } {
  const inputs: ApplyInput[] = [];
  return {
    inputs,
    async apply(input) {
      inputs.push(input);
      const r = reply(input);
      if (r instanceof Error) throw r;
      return { runId: "r", answer: null, status: "ok", model: "m", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.002, durationMs: 900, ...r } as ApplyResult;
    },
  };
}

describe("the WithAI council", () => {
  it("makes one cheap apply call per seat with its viewpoint, the skill and the council answer shape, and adds up the cost", async () => {
    const f = fixture("weakened-skip");
    const client = fakeClient(() => wrap({ verdict: "pass", strength: 5, reason: "ok", quotes: [] }));
    const decision = await decideRun(f.run, f.config, withaiCouncil({ client, skill: { id: "00000000-0000-4000-8000-000000000000" } }));
    const seats = f.config.council.seats;
    expect(client.inputs.map((i) => i.viewpoint)).toEqual(seats);
    for (const input of client.inputs) {
      expect(input).toMatchObject({ tier: "cheap", maxTokens: 1536, skill: { id: "00000000-0000-4000-8000-000000000000" }, profile: COUNCIL_PROFILE });
      expect(input.answer.type).toBe("schema");
      expect((input.answer as unknown as { schema: unknown }).schema).toMatchObject({ type: "object", required: ["verdict", "strength", "reason", "quotes"] });
      expect((input.state as { diff: string }).diff).toBe(f.run.diff);
    }
    expect(decision.result).toBe("pass");
    expect(decision.costUsd).toBeCloseTo(0.002 * seats.length);
    // Each seat keeps WithAI's run id, so its outcome can be reported later.
    expect(decision.questions.flatMap((q) => q.seats.map((seat) => seat.runId))).toEqual(expect.arrayContaining(["r"]));
  });

  it("an invalid answer, a failed call and the daily limit each count as needs-person, so a person is asked", async () => {
    const f = fixture("weakened-skip");
    let n = 0;
    const client = fakeClient(() => {
      n++;
      if (n === 1) return { status: "invalid", error: "missing verdict", answer: null };
      if (n === 2) return new WithAIError(429, { message: "Daily limit reached" });
      if (n === 3) return new Error("fetch failed");
      return wrap({ verdict: "pass", strength: 5, reason: "ok", quotes: [] });
    });
    const decision = await decideRun(f.run, f.config, withaiCouncil({ client, skill: { text: "policy" } }));
    expect(decision.result).toBe("waiting");
    const problems = decision.questions[0]!.seats.flatMap((s) => s.problems).join(" | ");
    expect(problems).toContain("missing verdict");
    expect(problems).toContain("WithAI daily limit reached");
    expect(problems).toContain("fetch failed");
  });

  it("gives up on a seat call that takes too long", async () => {
    const f = fixture("weakened-skip");
    const client: ApplyClient = {
      apply: (_input, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal!.reason))),
    };
    const decision = await decideRun(f.run, f.config, withaiCouncil({ client, skill: { text: "policy" }, timeoutMs: 50 }));
    expect(decision.result).toBe("waiting");
    expect(decision.questions[0]!.seats.every((s) => s.problems[0] === "call failed: WithAI did not answer in time")).toBe(true);
  });

  it("cuts a very large diff before sending it", async () => {
    const f = fixture("weakened-skip");
    const run = { ...f.run, diff: f.run.diff + "x".repeat(MAX_DIFF_CHARS * 2) };
    const client = fakeClient(() => ({ answer: null }));
    await decideRun(run, f.config, withaiCouncil({ client, skill: { text: "policy" } }));
    expect((client.inputs[0]!.state as { diff: string }).diff.length).toBeLessThan(MAX_DIFF_CHARS + 100);
  });

  it("recorded answers replay to the same decision with no call, and a question without a recording goes to a person", async () => {
    const f = fixture("flaky-and-sensitive");
    const quote = f.run.jobs[0]!.attempts[0]!.logExcerpt;
    const client = fakeClient((input) =>
      input.viewpoint!.startsWith("Security") ? wrap({ verdict: "fail", strength: 4, reason: "real", quotes: [{ source: "log", text: quote }] }) : wrap({ verdict: "pass", strength: 5, reason: "ok", quotes: [] }),
    );
    const recording: Recording = {};
    const live = await decideRun(f.run, f.config, recordingCouncil(withaiCouncil({ client, skill: { text: "policy" } }), recording));
    const calls = client.inputs.length;
    const replayed = await decideRun(f.run, f.config, replayCouncil(JSON.parse(JSON.stringify(recording)) as Recording));
    expect(client.inputs.length).toBe(calls);
    expect(replayed.result).toBe(live.result);
    expect(replayed.questions.map((q) => q.outcome)).toEqual(live.questions.map((q) => q.outcome));

    const empty = await decideRun(f.run, f.config, replayCouncil({}));
    expect(empty.result).toBe("waiting");
  });
});

describe("seat outcomes", () => {
  const seat = (verdict: CheckedSeat["verdict"], runId?: string): CheckedSeat => ({
    seat: "s",
    verdict,
    strength: 3,
    reason: "",
    validQuotes: [],
    problems: [],
    ...(runId ? { runId } : {}),
  });

  it("scores each seat against the person: same is correct, opposite is incorrect, deferring is partial", () => {
    expect(seatOutcomes([seat("pass", "a"), seat("fail", "b"), seat("needs-person", "c")], "pass").map((o) => [o.runId, o.outcome])).toEqual([
      ["a", "correct"],
      ["b", "incorrect"],
      ["c", "partial"],
    ]);
  });

  it("skips seats that never reached WithAI", () => {
    expect(seatOutcomes([seat("pass")], "pass")).toEqual([]);
  });
});
