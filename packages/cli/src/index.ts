#!/usr/bin/env node
// PullUp CLI — init / fetch / analyze / report / config, plus the Jev risk
// layer: signals / calibrate / actions.

import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { DEFAULT_PRIORS, loadConfig } from "@pullup/core";
import type { JevMode, JevRuntime, PullSource, ResolvedConfig } from "@pullup/core";
import type { SignalModelKind } from "@pullup/jev";
import { SqliteStore } from "@pullup/db";
import { OctokitPullSource } from "@pullup/github";
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
interface GlobalOpts {
  db?: string;
}

function openStore(opts: GlobalOpts): { client: Client; store: SqliteStore } {
  const dbPath = opts.db ?? "pullup.db";
  const client = createClient({ url: `file:${dbPath}` });
  return { client, store: new SqliteStore(client) };
}

async function withStore<T>(
  opts: GlobalOpts,
  fn: (s: SqliteStore) => Promise<T>,
): Promise<T> {
  const { client, store } = openStore(opts);
  await store.migrate();
  try {
    return await fn(store);
  } finally {
    client.close();
  }
}

async function resolveSource(repoId: string, fixture: string | undefined): Promise<PullSource> {
  if (fixture) {
    const { loadFixture } = await import("@pullup/github");
    return loadFixture(fixture, repoId);
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "Live fetch needs a GitHub token: set GITHUB_TOKEN (or use --fixture <file.json> for offline mode).",
    );
  }
  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: token });
  return new OctokitPullSource({ repoId, octokit });
}

interface JevCliOpts {
  jevMode?: JevMode;
  model?: SignalModelKind;
  replay?: string;
  calibration?: string;
}

/** Jev runtime for report-style commands (null when the layer is off). */
async function jevRuntimeFor(
  store: SqliteStore,
  repoId: string,
  cfg: ResolvedConfig,
  opts: JevCliOpts,
): Promise<JevRuntime | undefined> {
  const { prepareJevRuntime } = await import("@pullup/jev");
  const { runtime, run } = await prepareJevRuntime(store, repoId, cfg, {
    mode: opts.jevMode,
    kind: opts.model,
    replayPath: opts.replay,
    calibrationPath: opts.calibration,
  });
  if (run) {
    console.error(
      `[jev] ${run.modelId}: ${run.evaluated} evaluated · ${run.cached} cached · ${run.failed} failed · $${run.costUsd}`,
    );
  }
  return runtime ?? undefined;
}

function addJevOptions(cmd: Command): Command {
  return cmd
    .option("--jev-mode <mode>", "Jev risk layer: off | shadow | active (default: config)")
    .option("--model <kind>", "signal model: jev | synthetic | replay (default: jev if TYPESAFE_API_KEY)")
    .option("--replay <path>", "replay file for --model replay")
    .option("--calibration <path>", "calibration artifact (default: config jev.calibrationPath)");
}

const program = new Command();

program
  .name("pullup")
  .description("Dynamic-CI cost analytics: cost of waiting for review vs cost of shipping a bug.")
  .version("0.1.0")
  .option("-d, --db <path>", "SQLite database path", "pullup.db");

program
  .command("init")
  .description("Write a pullup.config.json with default priors")
  .option("-f, --force", "overwrite existing config")
  .action(async (opts: { force?: boolean }) => {
    const target = "pullup.config.json";
    const { existsSync } = await import("node:fs");
    if (existsSync(target) && !opts.force) {
      console.error(`pullup.config.json already exists (use --force to overwrite).`);
      process.exit(1);
    }
    writeFileSync(target, JSON.stringify(DEFAULT_PRIORS, null, 2) + "\n");
    console.log(`wrote ${target}`);
  });

program
  .command("fetch")
  .description("Ingest a repo into the SQLite store")
  .argument("<repoId>", "owner/repo (fixture repoId, or GitHub owner/repo)")
  .option("-f, --fixture <path>", "path to a fixture JSON file (offline)")
  .action(async (repoId: string, opts: { fixture?: string }) => {
    const source = await resolveSource(repoId, opts.fixture);
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const { ingestRepo } = await import("@pullup/core");
      const result = await ingestRepo(source, s);
      console.log(
        `ingested ${result.pulls} pulls / ${result.reviews} reviews / ${result.comments} comments / ${result.defects} defect events`,
      );
    });
  });

addJevOptions(program
  .command("analyze"))
  .description("Build and write a report (markdown + JSON) for a repo")
  .argument("<repoId>", "owner/repo as ingested")
  .option("-f, --fixture <path>", "ingest from fixture first (offline)")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .option("-o, --out <dir>", "output directory", "pullup-out")
  .action(async (repoId: string, opts: { fixture?: string; config: string; out: string } & JevCliOpts) => {
    const source = opts.fixture ? await resolveSource(repoId, opts.fixture) : null;
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      if (source) {
        const { ingestRepo } = await import("@pullup/core");
        await ingestRepo(source, s);
      }
      const { buildReport, renderMarkdown, renderJson } = await import("@pullup/core");
      const cfg = loadConfig(opts.config);
      const jev = await jevRuntimeFor(s, repoId, cfg, opts);
      const report = await buildReport(s, repoId, cfg.priors, { jev });
      const md = renderMarkdown(report);
      const json = renderJson(report);
      mkdirSync(opts.out, { recursive: true });
      writeFileSync(`${opts.out}/${repoId.replace("/", "__")}.md`, md);
      writeFileSync(`${opts.out}/${repoId.replace("/", "__")}.json`, json);
      console.log(`wrote ${opts.out}/${repoId.replace("/", "__")}.md/.json`);
    });
  });

addJevOptions(program
  .command("report"))
  .description("Print the markdown report for a repo to stdout")
  .argument("<repoId>", "owner/repo as ingested")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .action(async (repoId: string, opts: { config: string } & JevCliOpts) => {
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const { buildReport, renderMarkdown } = await import("@pullup/core");
      const cfg = loadConfig(opts.config);
      const jev = await jevRuntimeFor(s, repoId, cfg, opts);
      const report = await buildReport(s, repoId, cfg.priors, { jev });
      console.log(renderMarkdown(report));
    });
  });

program
  .command("signals")
  .description("Evaluate Jev risk signals for a repo's diff hunks (cached; only new hunks cost)")
  .argument("<repoId>", "owner/repo as ingested")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .option("--model <kind>", "signal model: jev | synthetic | replay")
  .option("--replay <path>", "replay file for --model replay")
  .option("--record <path>", "write every answer to a replay file")
  .option("--pr <numbers...>", "only these pull numbers")
  .option("--open-only", "only open pulls")
  .action(
    async (
      repoId: string,
      opts: { config: string; model?: SignalModelKind; replay?: string; record?: string; pr?: string[]; openOnly?: boolean },
    ) => {
      const { QUESTION_SETS, exportReplayFile, runSignals } = await import("@pullup/core");
      const { resolveSignalModel } = await import("@pullup/jev");
      const cfg = loadConfig(opts.config);
      const qs = QUESTION_SETS[cfg.jev.questionSet];
      if (!qs) throw new Error(`Unknown question set "${cfg.jev.questionSet}".`);
      const { model, note } = resolveSignalModel({ kind: opts.model, replayPath: opts.replay, config: cfg.jev });
      if (note) console.error(`[jev] ${note}`);
      const pullNumbers = opts.pr?.map(Number);
      await withStore(program.opts<GlobalOpts>(), async (s) => {
        const run = await runSignals(s, repoId, model, qs, {
          pullNumbers,
          openOnly: opts.openOnly,
          budgetUsd: cfg.jev.budgetUsdPerRun,
        });
        console.log(JSON.stringify(run, null, 2));
        if (opts.record) {
          // From the cache, so units answered in earlier runs are included too.
          const file = await exportReplayFile(s, repoId, qs, model.id, pullNumbers);
          writeFileSync(opts.record, JSON.stringify(file, null, 2) + "\n");
          console.error(`[jev] recorded ${Object.keys(file.entries).length} unit(s) → ${opts.record}`);
        }
      });
    },
  );

program
  .command("calibrate")
  .description("Fit + validate the Jev risk model on the repo's labelled history; write a calibration artifact")
  .argument("<repoId>", "owner/repo as ingested")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .option("--model <kind>", "signal model: jev | synthetic | replay")
  .option("--replay <path>", "replay file for --model replay")
  .option("-o, --out <path>", "artifact path (default .pullup/calibration.<owner>__<repo>.json)")
  .action(
    async (repoId: string, opts: { config: string; model?: SignalModelKind; replay?: string; out?: string }) => {
      const { QUESTION_SETS, calibrateRepo, runSignals } = await import("@pullup/core");
      const { resolveSignalModel } = await import("@pullup/jev");
      const cfg = loadConfig(opts.config);
      const qs = QUESTION_SETS[cfg.jev.questionSet];
      if (!qs) throw new Error(`Unknown question set "${cfg.jev.questionSet}".`);
      const { model, note } = resolveSignalModel({ kind: opts.model, replayPath: opts.replay, config: cfg.jev });
      if (note) console.error(`[jev] ${note}`);
      await withStore(program.opts<GlobalOpts>(), async (s) => {
        // Labelled history = merged pulls; evaluate them (cached) first.
        const run = await runSignals(s, repoId, model, qs, { budgetUsd: cfg.jev.budgetUsdPerRun });
        console.error(`[jev] ${run.evaluated} evaluated · ${run.cached} cached · $${run.costUsd}`);
        const artifact = await calibrateRepo(s, repoId, cfg.priors, qs, model.id, {
          policy: cfg.policy,
          config: cfg.jev,
        });
        const out = opts.out ?? `.pullup/calibration.${repoId.replace("/", "__")}.json`;
        mkdirSync(out.includes("/") ? out.slice(0, out.lastIndexOf("/")) : ".", { recursive: true });
        writeFileSync(out, JSON.stringify(artifact, null, 2) + "\n");
        const m = artifact.metrics;
        console.log(`calibration ${artifact.hash} → ${out}`);
        console.log(
          `labelled ${artifact.labelled.withSignals} merged (${artifact.labelled.defects} defects) · ` +
            `AUROC ${m.fitted.auroc} (uncal ${m.uncalibrated.auroc}) · ECE ${m.fitted.ece} (uncal ${m.uncalibrated.ece})`,
        );
        console.log(
          `backtest: rules-only ${artifact.backtest.rulesOnlyCostHours}h vs with-Jev ${artifact.backtest.withJevCostHours}h (Δ ${artifact.backtest.deltaHours}h)`,
        );
        for (const [label, gate] of [["multiplier gate", artifact.gate], ["fast-path gate", artifact.fastPathGate]] as const) {
          console.log(`${label}: ${gate.passed ? "PASSED" : "FAILED"}`);
          for (const c of gate.checks) {
            console.log(`  ${c.passed ? "✓" : "✗"} ${c.name}: ${c.value ?? "—"} (threshold ${c.threshold})`);
          }
        }
      });
    },
  );

addJevOptions(program
  .command("actions"))
  .description("Plan bot review actions (approve / request changes / defer to human) and LOG them — nothing is sent to GitHub")
  .argument("<repoId>", "owner/repo as ingested")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .action(async (repoId: string, opts: { config: string } & JevCliOpts) => {
    const { buildReport, planReviewActions, LoggingReviewActuator } = await import("@pullup/core");
    const cfg = loadConfig(opts.config);
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const jev = await jevRuntimeFor(s, repoId, cfg, opts);
      const report = await buildReport(s, repoId, cfg.priors, { jev });
      const planned = planReviewActions(report.decisions, await s.listPulls(repoId), {
        repoId,
        humanReviewers: cfg.jev.humanReviewers,
      });
      const logged = await new LoggingReviewActuator(s).apply(planned);
      console.log(JSON.stringify(logged, null, 2));
      console.error(`[actions] logged ${logged.length} review action(s); approval authority is stubbed — nothing sent.`);
    });
  });

program
  .command("config")
  .description("Show the resolved configuration and provenance")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .action(async (opts: { config: string }) => {
    const cfg = loadConfig(opts.config);
    const out = {
      path: cfg.path,
      fileOverrides: cfg.fileOverrides,
      priors: cfg.priors,
    };
    console.log(JSON.stringify(out, null, 2));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
