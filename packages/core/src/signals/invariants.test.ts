// The Jev layer's safety contract, checked end-to-end on the bundled fixtures
// with the deterministic synthetic model.

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { DEFAULT_PRIORS } from "../config/config.js";
import { ingestRepo } from "../ingest/pipeline.js";
import type { FixtureFile } from "../ingest/source.js";
import { DEFAULT_POLICY } from "../policy/policy.js";
import { buildReport } from "../report/build.js";
import { renderJson, renderMarkdown } from "../report/render.js";
import { InMemoryStore } from "../schema/store.js";
import { planReviewActions, LoggingReviewActuator } from "../actions/review.js";
import { sourceFromFixtureFile } from "../testing/hunks.js";
import { SyntheticSignalModel } from "../testing/synthetic-signals.js";
import { calibrateRepo, loadCalibration } from "./calibrate.js";
import type { CalibrationArtifact } from "./calibrate.js";
import { resolveJevConfig } from "./config.js";
import type { JevMode } from "./config.js";
import { QUESTION_SET_V1 } from "./questions/v1.js";
import { runSignals } from "./run.js";
import type { JevRuntime } from "./runtime.js";
import type { SignalModel } from "./types.js";

const NOW = "2026-09-01T00:00:00.000Z";
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../../fixtures/${name}.json`, import.meta.url), "utf8")) as FixtureFile;

/** Report hashes captured on `main` before the Jev layer existed. */
const MAIN_BASELINE: Record<string, string> = {
  healthy: "59b64b4cd410a73603ce8fcb0bf3a46d749f4ba632a96ae640f5b57d2970156e",
  congested: "1a9e6f614ada5b2183a721b141a88c030478db304469217ce64e53e2d2d8d49f",
};

async function load(name: string, model: SignalModel = new SyntheticSignalModel()) {
  const store = new InMemoryStore();
  await ingestRepo(sourceFromFixtureFile(fixture(name)), store, { now: NOW });
  await runSignals(store, `fixtures/${name}`, model, QUESTION_SET_V1, { now: NOW });
  return store;
}

function runtime(mode: JevMode, calibration: CalibrationArtifact | null = null, modelId = "synthetic-v1"): JevRuntime {
  return {
    config: resolveJevConfig({ mode }),
    policy: DEFAULT_POLICY,
    qs: QUESTION_SET_V1,
    modelId,
    calibration,
  };
}

function hashOf(r: Awaited<ReturnType<typeof buildReport>>): string {
  return createHash("sha256").update(renderJson(r) + "\n---\n" + renderMarkdown(r)).digest("hex");
}

describe("invariant 1 — layer off ⇒ report byte-identical to main", () => {
  for (const name of ["healthy", "congested"]) {
    it(name, async () => {
      const store = await load(name);
      const plain = await buildReport(store, `fixtures/${name}`, DEFAULT_PRIORS, { now: NOW });
      const off = await buildReport(store, `fixtures/${name}`, DEFAULT_PRIORS, { now: NOW, jev: runtime("off") });
      expect(hashOf(plain)).toBe(MAIN_BASELINE[name]);
      expect(hashOf(off)).toBe(MAIN_BASELINE[name]);
    });
  }
});

describe("scenario fixture (fixtures/jev)", () => {
  let store: InMemoryStore;
  beforeAll(async () => {
    store = await load("jev");
  });
  const repo = "fixtures/jev";
  const build = (mode: JevMode, cal: CalibrationArtifact | null = null) =>
    buildReport(store, repo, DEFAULT_PRIORS, { now: NOW, jev: runtime(mode, cal) });

  it("invariant 2 — a policy hit always escalates, regardless of signals", async () => {
    // A model that says "nothing risky here" about everything.
    const quiet: SignalModel = {
      id: "quiet",
      async evaluate(units, qs) {
        return units.map(() => ({
          answers: Object.fromEntries(
            Object.entries(qs.questions).map(([id, s]) => [
              id,
              s.kind === "noul"
                ? { kind: "noul" as const, p: 0 }
                : s.kind === "choice"
                  ? { kind: "choice" as const, choice: "docs", confidence: 1, probabilities: { docs: 1 } }
                  : { kind: "score" as const, score: 0, confidence: 1, probabilities: { "0": 1 } },
            ]),
          ),
          modelId: "quiet",
          inputTokens: 1,
          latencyMs: 0,
        }));
      },
    };
    const s = await load("jev", quiet);
    const r = await buildReport(s, repo, DEFAULT_PRIORS, { now: NOW, jev: runtime("active", null, "quiet") });
    const d = r.decisions.find((x) => x.pullNumber === 1001)!;
    expect(d.recommendation).toBe("escalate");
    expect(d.risk!.band).toBe("escalate");
  });

  it("invariant 4 — the injection PR is escalated and never fast-pathed", async () => {
    const r = await build("active");
    const d = r.decisions.find((x) => x.pullNumber === 1002)!;
    expect(d.risk!.band).toBe("escalate");
    expect(d.risk!.fastPathEligible).toBe(false);
    expect(d.risk!.escalateReasons.join(" ")).toMatch(/injection tripwire/);
    expect(d.recommendation).toBe("escalate");
  });

  it("invariant 5 — shadow recommendations equal layer-off recommendations", async () => {
    const off = await buildReport(store, repo, DEFAULT_PRIORS, { now: NOW });
    const shadow = await build("shadow");
    expect(shadow.decisions.map((d) => [d.pullNumber, d.recommendation, d.maxWaitHours])).toEqual(
      off.decisions.map((d) => [d.pullNumber, d.recommendation, d.maxWaitHours]),
    );
    expect(shadow.summary.counts).toEqual(off.summary.counts);
    expect(shadow.decisions.find((d) => d.pullNumber === 1004)!.risk!.shadowRecommendation).toBe("escalate");
  });

  it("scenario bands: policy / injection / auth escalate; docs + formatting fast-path", async () => {
    const r = await build("active");
    const band = (n: number) => r.decisions.find((d) => d.pullNumber === n)!.risk!.band;
    expect([band(1001), band(1002), band(1004)]).toEqual(["escalate", "escalate", "escalate"]);
    expect(band(1003)).toBe("fast-path");
    expect(band(1005)).toBe("fast-path");
    expect(r.risk!.counts.escalate).toBeGreaterThanOrEqual(3);
  });

  it("review actions: escalations defer to a human; fast path approves — logged only", async () => {
    const r = await build("active");
    const planned = planReviewActions(r.decisions, await store.listPulls(repo), {
      repoId: repo,
      humanReviewers: ["security-team"],
    });
    const by = (n: number) => planned.find((a) => a.pullNumber === n);
    for (const n of [1001, 1002, 1004]) {
      expect(by(n)).toMatchObject({ action: "defer_to_human", source: "jev-escalate" });
      expect(by(n)!.call.createReview.event).toBe("COMMENT");
      expect(by(n)!.call.requestReviewers!.reviewers).toEqual(["security-team"]);
    }
    // Docs PR: the TCM itself says auto-approve at this wait → APPROVE event.
    expect(by(1003)).toMatchObject({ action: "approve" });
    expect(by(1003)!.call.createReview.event).toBe("APPROVE");
    expect(by(1003)!.call.createReview.commit_id).toBe("cafe000000001003");

    const logged = await new LoggingReviewActuator(store, () => NOW).apply(planned);
    expect(logged.every((l) => l.status === "logged")).toBe(true);
    expect(await store.listReviewActions(repo)).toHaveLength(planned.length);
  });
});

describe("calibration + invariant 3/6 (calibrated multiplier)", () => {
  let store: InMemoryStore;
  let artifact: CalibrationArtifact;
  const config = resolveJevConfig({ mode: "active" });
  beforeAll(async () => {
    store = await load("calibration");
    artifact = await calibrateRepo(store, "fixtures/calibration", DEFAULT_PRIORS, QUESTION_SET_V1, "synthetic-v1", {
      now: NOW,
      policy: DEFAULT_POLICY,
      config,
    });
  }, 60_000);

  it("is deterministic and finds real signal", async () => {
    const again = await calibrateRepo(store, "fixtures/calibration", DEFAULT_PRIORS, QUESTION_SET_V1, "synthetic-v1", {
      now: NOW,
      policy: DEFAULT_POLICY,
      config,
    });
    expect(again.hash).toBe(artifact.hash);
    expect(artifact.labelled.withSignals).toBeGreaterThanOrEqual(200);
    expect(artifact.metrics.fitted.auroc!).toBeGreaterThan(0.75);
    // Fitting improves calibration over the hand-set weights.
    expect(artifact.metrics.fitted.ece).toBeLessThan(artifact.metrics.uncalibrated.ece);
    // Monotone features never get negative weights.
    for (const [n, w] of Object.entries(artifact.weights.features)) {
      if (n.startsWith("max:") || n === "blastMax") expect(w).toBeGreaterThanOrEqual(0);
    }
    expect(artifact.gate.checks.map((c) => c.name)).toContain("out-of-fold adaptive ECE");
  });

  it("a failed gate keeps the multiplier at 1", async () => {
    const failing = { ...artifact, gate: { ...artifact.gate, passed: false } };
    const r = await buildReport(store, "fixtures/calibration", DEFAULT_PRIORS, {
      now: NOW,
      jev: runtime("active", failing),
    });
    expect(r.decisions.filter((d) => d.risk).every((d) => d.risk!.multiplier === 1)).toBe(true);
    expect(r.risk!.weightsSource).toBe("config (uncalibrated)");
  });

  it("with a passing calibration: m ≥ 1 everywhere and w* never shortens", async () => {
    const passing = { ...artifact, gate: { ...artifact.gate, passed: true } };
    const off = await buildReport(store, "fixtures/calibration", DEFAULT_PRIORS, { now: NOW });
    const on = await buildReport(store, "fixtures/calibration", DEFAULT_PRIORS, {
      now: NOW,
      jev: runtime("active", passing),
    });
    expect(on.risk!.weightsSource).toBe("calibration");
    const offW = new Map(off.decisions.map((d) => [d.pullNumber, d.maxWaitHours]));
    const withRisk = on.decisions.filter((d) => d.risk);
    expect(withRisk.length).toBeGreaterThan(0);
    for (const d of withRisk) {
      expect(d.risk!.multiplier).toBeGreaterThanOrEqual(1);
      expect(d.maxWaitHours).toBeGreaterThanOrEqual(offW.get(d.pullNumber)!);
    }
    expect(withRisk.some((d) => d.risk!.multiplier > 1)).toBe(true);
  });

  it("artifact integrity: loadCalibration rejects hand edits", async () => {
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "pullup-cal-"));
    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify(artifact, null, 2));
    expect(loadCalibration(good).hash).toBe(artifact.hash);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ ...artifact, gate: { ...artifact.gate, passed: true } }, null, 2));
    if (!artifact.gate.passed) expect(() => loadCalibration(bad)).toThrow(/integrity/);
  });
});
