// pullup preview: a local branch through the same core calls as a pull
// request, without touching the stored history (except cached signal answers).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { approvalGate } from "../actions/approval.js";
import { resolveConfig } from "../config/config.js";
import type { ConfigFile } from "../config/schema.js";
import { ingestRepo } from "../ingest/pipeline.js";
import type { FixtureFile } from "../ingest/source.js";
import { buildReport } from "../report/build.js";
import { configReportOptions } from "../config/config.js";
import type { HunkRecord } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";
import { InMemoryStore } from "../schema/store.js";
import { resolveQuestionSet } from "../signals/questions/custom.js";
import { runSignals } from "../signals/run.js";
import { sourceFromFixtureFile } from "../testing/hunks.js";
import { SyntheticSignalModel } from "../testing/synthetic-signals.js";
import { parseGitDiff } from "./diff.js";
import { createOverlayStore } from "./overlay-store.js";
import { renderPreview } from "./result.js";
import { PREVIEW_PULL_NUMBER, runPreview } from "./run.js";

const NOW = "2026-09-01T00:00:00.000Z";
const REPO = "fixtures/jev";
const fixture = JSON.parse(readFileSync(new URL("../../../../fixtures/jev.json", import.meta.url), "utf8")) as FixtureFile;

const FILE: ConfigFile = { jev: { mode: "active" } };

async function loaded() {
  const store = new InMemoryStore();
  await ingestRepo(sourceFromFixtureFile(fixture), store, { now: NOW, repoId: REPO });
  const cfg = resolveConfig({ file: FILE });
  await runSignals(store, REPO, new SyntheticSignalModel(), resolveQuestionSet(cfg.jev), { now: NOW });
  return { store, cfg };
}

const prepareJev = (cfg: ReturnType<typeof resolveConfig>) => async (s: PullStore, pullNumbers: readonly number[]) => {
  const qs = resolveQuestionSet(cfg.jev);
  const model = new SyntheticSignalModel();
  await runSignals(s, REPO, model, qs, { pullNumbers: [...pullNumbers], now: NOW });
  return { runtime: { config: cfg.jev, policy: cfg.policy, qs, modelId: model.id, calibration: null }, notes: [] };
};

const file = (path: string, header: string, body: string[], extra = "") =>
  `diff --git a/${path} b/${path}\n${extra}--- a/${path}\n+++ b/${path}\n${header}\n${body.join("\n")}\n`;

async function preview(diff: string, over: { author?: string; ai?: boolean; headSha?: string } = {}) {
  const { store, cfg } = await loaded();
  const before = { pulls: (await store.listPulls(REPO)).length, hunks: (await store.listHunks(REPO)).length, runs: (await store.listSignalRuns(REPO)).length };
  const { result } = await runPreview({
    store,
    repoId: REPO,
    cfg,
    diff,
    base: "main",
    head: "feat/x",
    headSha: "localsha",
    now: NOW,
    prepareJev: prepareJev(cfg),
    approval: approvalGate({ repoId: REPO, delivery: "log", calibration: null }),
    ...over,
  });
  const after = { pulls: (await store.listPulls(REPO)).length, hunks: (await store.listHunks(REPO)).length, runs: (await store.listSignalRuns(REPO)).length };
  return { result, before, after, store };
}

describe("parseGitDiff", () => {
  it("handles modified, added, deleted, renamed and binary files", () => {
    const diff = [
      file("src/a.ts", "@@ -1,2 +1,3 @@", [" x", "-y", "+y2", "+z"]),
      "diff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+hi\n",
      "diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n",
      "diff --git a/old.ts b/moved.ts\nsimilarity index 100%\nrename from old.ts\nrename to moved.ts\n",
      "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n",
    ].join("");
    expect(parseGitDiff(diff).map((f) => [f.path, f.status, f.additions, f.deletions, f.patch === null])).toEqual([
      ["src/a.ts", "modified", 2, 1, false],
      ["new.ts", "added", 1, 0, false],
      ["gone.ts", "deleted", 0, 1, false],
      ["moved.ts", "renamed", 0, 0, true],
      ["logo.png", "modified", 0, 0, true],
    ]);
  });
});

describe("overlay store", () => {
  it("keeps writes in memory, except signal answers", async () => {
    const real = new InMemoryStore();
    const overlay = createOverlayStore(real);
    await overlay.upsertPull({ repoId: REPO, number: 0, state: "open" } as never);
    await overlay.replaceHunks(REPO, 0, [{ repoId: REPO, pullNumber: 0, path: "a", index: 0, header: "", patch: "", noPatch: true, contentHash: "h" } as HunkRecord]);
    await overlay.upsertSignal({ cacheKey: "k", modelId: "m", questionSet: "q", answers: {}, createdAt: NOW } as never);
    expect(await real.listPulls(REPO)).toEqual([]);
    expect(await real.listHunks(REPO)).toEqual([]);
    expect(await real.getSignal("k")).not.toBeNull();
    expect((await overlay.listPulls(REPO)).map((p) => p.number)).toEqual([0]);
    expect(await overlay.getPull(REPO, 0)).not.toBeNull();
  });
});

describe("runPreview", () => {
  it("a CI workflow change always needs a human, with a hint; the stored history is unchanged", async () => {
    const { result, before, after } = await preview(file(".github/workflows/ci.yml", "@@ -1,2 +1,3 @@", [" on: push", "+permissions: write-all", " jobs:"]));
    expect(result.would.action).toBe("defer_to_human");
    expect(result.fastPath.eligible).toBe(false);
    expect(result.fastPath.blockers[0]).toMatchObject({ kind: "always-human", hint: expect.stringMatching(/always needs a human/) });
    expect(result.sent).toBe(false);
    expect(after).toEqual(before);
    expect(renderPreview(result)).toContain("Nothing was sent to GitHub.");
  });

  it("lists changed walkthroughs, and suggests one when a human will review", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const ci = file(".github/workflows/ci.yml", "@@ -1,2 +1,3 @@", [" on: push", "+permissions: write-all", " jobs:"]);
    const bare = await preview(ci, { headSha: sha });
    expect(bare.result.walkthroughs).toEqual([]);
    expect(renderPreview(bare.result)).toMatch(/Walkthrough: none — a human will review/);
    const spec = file("specs/ci-permissions.md", "@@ -0,0 +1 @@", ["+# Why CI needs write"], "new file mode 100644\n");
    const withSpec = await preview(ci + spec, { headSha: sha });
    expect(withSpec.result.walkthroughs).toEqual(["specs/ci-permissions.md"]);
    expect(withSpec.result.would.action).toBe(bare.result.would.action);
    expect(renderPreview(withSpec.result)).toContain("Walkthrough: specs/ci-permissions.md");
  });

  it("an unknown author is not treated as a first-time contributor, and says so", async () => {
    const { result } = await preview(file("docs/guide.md", "@@ -1 +1,2 @@", [" # Guide", "+More words."]));
    expect(result.fastPath.blockers.some((b) => /First-time contributor/.test(b.detail))).toBe(false);
    expect(result.notes.join(" ")).toMatch(/Author unknown/);
    const named = await preview(file("docs/guide.md", "@@ -1 +1,2 @@", [" # Guide", "+More words."]), { author: "never-seen-before" });
    expect(named.result.fastPath.blockers.some((b) => /First-time contributor/.test(b.detail))).toBe(true);
  });

  it("matches the real path's findings and guardrails for every fixture pull request", async () => {
    const { store, cfg } = await loaded();
    const real = await buildReport(store, REPO, cfg.priors, { now: NOW, jev: (await prepareJev(cfg)(store, [])).runtime!, ...configReportOptions(cfg) });
    const hunks = await store.listHunks(REPO);
    for (const pull of (await store.listPulls(REPO)).filter((p) => p.state === "open")) {
      const ph = hunks.filter((h) => h.pullNumber === pull.number);
      if (ph.length === 0) continue;
      const diff = [...new Set(ph.map((h) => h.path))]
        .map((path) => {
          const hs = ph.filter((h) => h.path === path);
          if (hs.some((h) => h.noPatch)) return `diff --git a/${path} b/${path}\nBinary files a/${path} and b/${path} differ\n`;
          return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hs.map((h) => `${h.header}\n${h.patch}`).join("\n")}\n`;
        })
        .join("");
      const { result } = await runPreview({
        store,
        repoId: REPO,
        cfg,
        diff,
        base: "main",
        head: `pr-${pull.number}`,
        headSha: pull.headSha,
        author: pull.author,
        labels: pull.labels,
        now: NOW,
        prepareJev: prepareJev(cfg),
        approval: { unlocked: false, reason: null },
      });
      const d = real.decisions.find((x) => x.pullNumber === pull.number)!;
      // "Costs more than it's worth" depends on how long the pull request has waited (a preview has waited 0 h).
      const timeless = (ids: string[]) => ids.filter((x) => !x.startsWith("rule:net-negative")).sort();
      expect(timeless(result.findings.map((f) => `${f.id}:${f.level}`)), `#${pull.number}`).toEqual(timeless((d.findings ?? []).map((f) => `${f.id}:${f.level}`)));
      const blockers = [...(d.guardrails?.requireHuman ?? []), ...(d.guardrails?.approveBlockers ?? [])];
      // Size counts come from the diff itself; files and categories must match exactly.
      expect(result.fastPath.blockers.filter((b) => b.kind !== "finding").map((b) => b.detail).filter((x) => !/lines >/.test(x)).sort(), `#${pull.number}`).toEqual(
        [...blockers, ...(d.risk?.escalateReasons ?? []).filter((r) => !blockers.includes(r))].filter((x) => !/lines >/.test(x)).sort(),
      );
    }
    expect((await store.listPulls(REPO)).some((p) => p.number === PREVIEW_PULL_NUMBER)).toBe(false);
  });
});
