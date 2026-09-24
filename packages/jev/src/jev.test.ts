import { describe, expect, it } from "vitest";
import { QUESTION_SET_V1, buildUnits, hunkContentHash } from "@pullup/core";
import type { HunkRecord } from "@pullup/core";
import { JevSignalModel, toSdkQuestions } from "./jev.js";
import type { SystemOneClient } from "./jev.js";
import { resolveSignalModel } from "./factory.js";
import { DEFAULT_JEV_CONFIG } from "@pullup/core";

function hunk(patch: string): HunkRecord {
  const h = { path: "src/api/x.ts", header: "@@ -1,2 +1,3 @@", patch, noPatch: false };
  return { repoId: "o/r", pullNumber: 1, index: 0, ...h, contentHash: hunkContentHash(h) };
}

/** Fake client: answers every question type deterministically, records calls. */
function fakeClient(opts: { failOn?: string; model?: string } = {}) {
  const calls: Array<{ state: unknown; questions: Record<string, { type: string }> }> = [];
  const client: SystemOneClient = {
    async systemOne(req) {
      calls.push({ state: req.state, questions: req.questions as never });
      const st = req.state as { hunk: string };
      if (opts.failOn && st.hunk.includes(opts.failOn)) throw new Error("529 overloaded");
      const answers: Record<string, unknown> = {};
      for (const [id, q] of Object.entries(req.questions)) {
        if (q.type === "noul") answers[id] = { type: "noul", noul: 0.2 };
        else if (q.type === "choice") {
          answers[id] = { type: "choice", choice: "feature", confidence: 0.9, probabilities: { feature: 0.9 } };
        } else answers[id] = { type: "score", score: 1.5, confidence: 0.7, probabilities: { "0": 0.1 } };
      }
      return { model: opts.model ?? "jev-1.13.0", answers, usage: { input_tokens: 1234 } };
    },
  };
  return { client, calls };
}

describe("JevSignalModel", () => {
  it("maps the question set to SDK builders (noul/choice/score)", () => {
    const q = toSdkQuestions(QUESTION_SET_V1);
    expect(q.touchesAuthn!.type).toBe("noul");
    expect(q.changeKind!.type).toBe("choice");
    expect(q.blastRadius!.type).toBe("score");
    expect(Object.keys(q)).toHaveLength(Object.keys(QUESTION_SET_V1.questions).length);
  });

  it("asks every question in one call per unit with code-only state", async () => {
    const { client, calls } = fakeClient();
    const model = new JevSignalModel({ client, requestsPerMinute: 60_000 });
    const units = buildUnits([hunk("+const a = 1;")], QUESTION_SET_V1, { area: "api" });
    const [a] = await model.evaluate(units, QUESTION_SET_V1);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]!.state as object).sort()).toEqual(["area", "hunk", "path"]);
    expect(a!.modelId).toBe("jev-1.13.0");
    expect(a!.inputTokens).toBe(1234);
    expect(a!.answers.touchesAuthn).toEqual({ kind: "noul", p: 0.2 });
    expect(a!.answers.changeKind!.kind).toBe("choice");
  });

  it("returns null (unknown risk) for a unit whose call fails", async () => {
    const { client } = fakeClient({ failOn: "BOOM" });
    const errors: string[] = [];
    const model = new JevSignalModel({
      client,
      requestsPerMinute: 60_000,
      onError: (u) => errors.push(u.key),
    });
    const units = buildUnits(
      [hunk("+ok"), { ...hunk("+BOOM"), path: "src/api/y.ts" }],
      QUESTION_SET_V1,
      { area: "api" },
    );
    const res = await model.evaluate(units, QUESTION_SET_V1);
    expect(res.filter((r) => r === null)).toHaveLength(1);
    expect(errors).toEqual(["src/api/y.ts#0"]);
  });
});

describe("resolveSignalModel", () => {
  it("defaults to synthetic without a key, jev with one", () => {
    const off = resolveSignalModel({ config: DEFAULT_JEV_CONFIG, env: {} });
    expect(off.kind).toBe("synthetic");
    expect(off.note).toMatch(/not Jev/);
    const on = resolveSignalModel({ config: DEFAULT_JEV_CONFIG, env: { TYPESAFE_API_KEY: "k" } });
    expect(on.kind).toBe("jev");
    expect(on.model.id).toBe("jev-1.13.0");
  });
});
