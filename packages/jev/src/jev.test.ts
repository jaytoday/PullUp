import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { QUESTION_SET_V1, buildLintRuleSet, buildUnits, hunkContentHash, lintHunks, resolveQuestionSet } from "@pullup/core";
import type { HunkRecord } from "@pullup/core";
import { JevSignalModel, toSdkQuestions, wireIds } from "./jev.js";
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

describe("question ids on the wire", () => {
  it("sends plain ids as they are and anything else as positional q<n>, mapping answers back", async () => {
    const qs = resolveQuestionSet({ ...DEFAULT_JEV_CONFIG, customQuestions: [{ text: "change how invoice totals are rounded" }] });
    const ids = wireIds(qs);
    expect(ids.get("touchesAuthn")).toBe("touchesAuthn");
    expect(ids.get("custom:change-how-invoice-totals-are-rounded")).toBe("q0");
    for (const wire of ids.values()) expect(wire).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);

    const { client, calls } = fakeClient();
    const model = new JevSignalModel({ client, requestsPerMinute: 60_000 });
    const [a] = await model.evaluate(buildUnits([hunk("+total = round(x)")], qs, { area: "api" }), qs);
    expect(Object.keys(calls[0]!.questions)).toContain("q0");
    expect(Object.keys(calls[0]!.questions).some((k) => k.includes(":"))).toBe(false);
    expect(a!.answers["custom:change-how-invoice-totals-are-rounded"]).toEqual({ kind: "noul", p: 0.2 });
  });
});

describe("any System One server (systemone)", () => {
  /** A minimal System One server: answers every question, records each request body. */
  async function server(): Promise<{ url: string; bodies: Array<Record<string, unknown>>; auth: Array<string | undefined>; close: () => Promise<void> }> {
    const bodies: Array<Record<string, unknown>> = [];
    const auth: Array<string | undefined> = [];
    const srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (req.method !== "POST" || req.url !== "/v1/systemone") {
          res.writeHead(404).end();
          return;
        }
        const body = JSON.parse(raw) as { model: string; questions: Record<string, { type: string; criteria?: unknown }> };
        bodies.push(body);
        auth.push(req.headers.authorization);
        const answers: Record<string, unknown> = {};
        for (const [id, q] of Object.entries(body.questions)) {
          if (q.type === "noul") answers[id] = { type: "noul", noul: 0.91 };
          else if (q.type === "choice") {
            const labels = Object.keys(q.criteria as object);
            answers[id] = { type: "choice", choice: labels[0], confidence: 0.8, probabilities: Object.fromEntries(labels.map((l, i) => [l, i === 0 ? 0.8 : 0.2 / (labels.length - 1)])) };
          } else answers[id] = { type: "score", score: 1, confidence: 0.7, probabilities: { "0": 0.3, "1": 0.7 } };
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 321 } }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const { port } = srv.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}`, bodies, auth, close: () => new Promise((r) => srv.close(() => r())) };
  }

  it("talks to the server over HTTP, sends text state, and caches under model@host", async () => {
    const s = await server();
    try {
      const { model, kind } = resolveSignalModel({
        config: DEFAULT_JEV_CONFIG,
        env: { PULLUP_SYSTEMONE_URL: s.url, PULLUP_SYSTEMONE_MODEL: "jev-1.13" },
      });
      expect(kind).toBe("systemone");
      expect(model.id).toBe(`jev-1.13@${new URL(s.url).host}`);
      const units = buildUnits([hunk("+const a = 1;")], QUESTION_SET_V1, { area: "api" });
      const [a] = await model.evaluate(units, QUESTION_SET_V1);
      expect(a!.modelId).toBe(model.id);
      expect(a!.inputTokens).toBe(321);
      expect(a!.answers.touchesAuthn).toEqual({ kind: "noul", p: 0.91 });
      expect(s.bodies[0]!.model).toBe("jev-1.13");
      expect(s.bodies[0]!.state).toBe("File: src/api/x.ts\nArea: api\n\n@@ -1,2 +1,3 @@\n+const a = 1;");
      // No key configured: the SDK's placeholder, which a local server ignores.
      expect(s.auth[0]).toBe("Bearer none");
    } finally {
      await s.close();
    }
  });

  it("asks a lint question set (rule text as the question) and judges the answers", async () => {
    const s = await server();
    try {
      const { model } = resolveSignalModel({ config: DEFAULT_JEV_CONFIG, env: { PULLUP_SYSTEMONE_URL: s.url, PULLUP_SYSTEMONE_API_KEY: "k" } });
      const set = buildLintRuleSet({
        source: "directory",
        ref: null,
        commitSha: null,
        dir: ".agents/gallant",
        files: [{ path: "no-debug.md", content: "---\nappliesTo: \"*.ts\"\ntype: noul\n---\nDoes this file leave debugging prints in?\n" }],
      });
      const result = await lintHunks(model, set, [hunk("+console.log(x)")], { area: "api" });
      expect(result.failures.map((f) => [f.rulePath, f.reason])).toEqual([["no-debug.md", "yes 0.91 > 0.5"]]);
      const q = (s.bodies[0]!.questions as Record<string, { type: string; instructions: string }>)[set.rules[0]!.wireId]!;
      expect(q).toMatchObject({ type: "noul", instructions: "Does this file leave debugging prints in?\n" });
      expect(s.auth[0]).toBe("Bearer k");
    } finally {
      await s.close();
    }
  });

  it("needs a URL, and never takes one from repo settings", () => {
    expect(() => resolveSignalModel({ kind: "systemone", config: DEFAULT_JEV_CONFIG, env: {} })).toThrow(/PULLUP_SYSTEMONE_URL/);
    expect(() => resolveSignalModel({ kind: "systemone", config: DEFAULT_JEV_CONFIG, env: { PULLUP_SYSTEMONE_URL: "not a url" } })).toThrow(/not a URL/);
    // TypeSafe's key still wins when both are set.
    expect(resolveSignalModel({ config: DEFAULT_JEV_CONFIG, env: { TYPESAFE_API_KEY: "k", PULLUP_SYSTEMONE_URL: "http://localhost:1" } }).kind).toBe("jev");
  });
});
