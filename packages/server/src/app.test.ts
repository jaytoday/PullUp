import { createServer } from "node:http";
import type { AddressInfo, Server } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryStore, resolveJevConfig, resolvePolicy, resolvePriors } from "@pullup/core";
import type { ResolvedConfig } from "@pullup/core";
import { createApp } from "./app.js";

const NOW = "2026-09-01T00:00:00.000Z";
const fixturesDir = resolve(import.meta.dirname, "../../../fixtures");

function config(mode: "off" | "shadow" | "active" = "off"): ResolvedConfig {
  return {
    priors: resolvePriors(),
    jev: resolveJevConfig({ mode, humanReviewers: ["security-team"] }),
    policy: resolvePolicy(),
    path: null,
    fileOverrides: [],
  };
}

let server: Server;
let base: string;
const store = new InMemoryStore();

beforeAll(async () => {
  const handle = createApp({
    store,
    config: () => config(),
    now: () => NOW,
    fixturesDir,
    dataDir: mkdtempSync(join(tmpdir(), "pullup-server-")),
    env: {},
    allowIngest: true,
  });
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, body: (await res.json()) as any };
};
const post = async (path: string, body: unknown = {}) => {
  const res = await fetch(base + path, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};

describe("PullUp API", () => {
  it("config reports key presence only and lists fixtures", async () => {
    const { body } = await get("/api/config");
    expect(body.env).toEqual({ typesafeApiKey: false, signalModel: "synthetic", signalModelId: "synthetic-v1" });
    expect(body.fixtures).toEqual(expect.arrayContaining(["jev", "healthy", "calibration"]));
  });

  it("404s on an unknown repo and 400s on a bad mode", async () => {
    expect((await get("/api/repos/nope/nope/report")).status).toBe(404);
    await post("/api/ingest", { fixture: "jev" });
    expect((await get("/api/repos/fixtures/jev/report?mode=loud")).status).toBe(400);
  });

  it("ingest rejects path tricks", async () => {
    expect((await post("/api/ingest", { fixture: "../package" })).status).toBe(400);
  });

  it("GET report has no side effects: no signal run until POST", async () => {
    const before = await get("/api/repos/fixtures/jev/report?mode=shadow");
    expect(before.status).toBe(200);
    expect(before.body.report.risk.units.evaluated).toBe(0);
    expect((await get("/api/repos/fixtures/jev/signal-runs")).body).toHaveLength(0);

    const run = await post("/api/repos/fixtures/jev/signals", { scope: "open" });
    expect(run.body.run.evaluated).toBeGreaterThan(0);
    expect(run.body.note).toMatch(/not Jev/);

    const after = await get("/api/repos/fixtures/jev/report?mode=shadow");
    expect(after.body.report.risk.units.evaluated).toBe(after.body.report.risk.units.total);
    expect((await get("/api/repos")).body[0]).toMatchObject({ repoId: "fixtures/jev", lastSignalRun: expect.any(Object) });
  });

  it("mode=off returns no risk section; active escalates the scenario PRs", async () => {
    expect((await get("/api/repos/fixtures/jev/report?mode=off")).body.report.risk).toBeUndefined();
    const { body } = await get("/api/repos/fixtures/jev/report?mode=active");
    const rec = (n: number) => body.report.decisions.find((d: any) => d.pullNumber === n).recommendation;
    expect([rec(1001), rec(1002), rec(1004)]).toEqual(["escalate", "escalate", "escalate"]);
    expect(body.actions.find((a: any) => a.pullNumber === 1002).action).toBe("defer_to_human");
  });

  it("PR detail: units with answers, policy, cost curve, planned action", async () => {
    const { status, body } = await get("/api/repos/fixtures/jev/pulls/1002?mode=active");
    expect(status).toBe(200);
    expect(body.units[0].answers.answers.addressesReviewerOrAutomation.p).toBeGreaterThan(0.5);
    expect(body.curve.length).toBeGreaterThan(10);
    expect(body.curve[0]).toMatchObject({ w: 0 });
    expect(body.plannedAction.call.requestReviewers.reviewers).toEqual(["security-team"]);
    expect(body.policy.requiresHuman).toBe(false);
    expect((await get("/api/repos/fixtures/jev/pulls/1001")).body.policy.requiresHuman).toBe(true);
    expect((await get("/api/repos/fixtures/jev/pulls/99999")).status).toBe(404);
  });

  it("POST actions logs (never sends) and GET actions reads them back", async () => {
    const { body } = await post("/api/repos/fixtures/jev/actions?mode=active");
    expect(body.sent).toBe(0);
    expect(body.logged.every((a: any) => a.status === "logged")).toBe(true);
    const listed = (await get("/api/repos/fixtures/jev/actions")).body;
    expect(listed).toHaveLength(body.logged.length);
  });

  it("calibration: null before, artifact after POST", async () => {
    await post("/api/ingest", { fixture: "calibration" });
    const before = await get("/api/repos/fixtures/calibration/calibration");
    expect(before.status).toBe(200);
    expect(before.body.artifact).toBeNull();
    const made = await post("/api/repos/fixtures/calibration/calibrate");
    expect(made.body.artifact.labelled.withSignals).toBeGreaterThan(200);
    const got = await get("/api/repos/fixtures/calibration/calibration");
    expect(got.body.artifact.hash).toBe(made.body.artifact.hash);
  }, 60_000);
});
