#!/usr/bin/env node
// PullUp CLI — init / fetch / analyze / report / config, plus the Jev risk
// layer: signals / calibrate / actions, and the authority layer (operator
// only, docs/authority.md): stop / resume / enroll / agents / evidence / impact.

import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { DEFAULT_PRIORS, configReportOptions, loadConfig, loadRepoConfig, resolveQuestionSet } from "@pullup/core";
import type { JevMode, JevRuntime, PullSource, ResolvedConfig } from "@pullup/core";
import type { SignalModelKind } from "@pullup/jev";
import { SqliteStore } from "@pullup/db";
import { OctokitPullSource } from "@pullup/github";
import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
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
  const { createRepoOctokit, githubAuthMode } = await import("@pullup/github");
  if (!githubAuthMode()) {
    throw new Error(
      "Live fetch needs GitHub credentials: GITHUB_APP_ID + GITHUB_PRIVATE_KEY (App) or GITHUB_TOKEN (or use --fixture <file.json> for offline mode).",
    );
  }
  return new OctokitPullSource({ repoId, octokit: await createRepoOctokit(repoId) });
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
    .option("--jev-mode <mode>", "Jev risk signals: off | shadow (observe) | active (use in decisions); default: config")
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
      const cfg = await loadRepoConfig(s, repoId, opts.config);
      const jev = await jevRuntimeFor(s, repoId, cfg, opts);
      const report = await buildReport(s, repoId, cfg.priors, { jev, configPath: cfg.path, ...configReportOptions(cfg) });
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
      const cfg = await loadRepoConfig(s, repoId, opts.config);
      const jev = await jevRuntimeFor(s, repoId, cfg, opts);
      const report = await buildReport(s, repoId, cfg.priors, { jev, configPath: cfg.path, ...configReportOptions(cfg) });
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
      const { exportReplayFile, runSignals } = await import("@pullup/core");
      const { resolveSignalModel } = await import("@pullup/jev");
      const pullNumbers = opts.pr?.map(Number);
      await withStore(program.opts<GlobalOpts>(), async (s) => {
        const cfg = await loadRepoConfig(s, repoId, opts.config);
        const qs = resolveQuestionSet(cfg.jev);
        const { model, note } = resolveSignalModel({ kind: opts.model, replayPath: opts.replay, config: cfg.jev });
        if (note) console.error(`[jev] ${note}`);
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
      const { calibrateRepo, runSignals } = await import("@pullup/core");
      const { resolveSignalModel } = await import("@pullup/jev");
      await withStore(program.opts<GlobalOpts>(), async (s) => {
        const cfg = await loadRepoConfig(s, repoId, opts.config);
        const qs = resolveQuestionSet(cfg.jev);
        const { model, note } = resolveSignalModel({ kind: opts.model, replayPath: opts.replay, config: cfg.jev });
        if (note) console.error(`[jev] ${note}`);
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
  .description(
    "Plan bot review actions (approve / request changes / defer to human). Logged only, unless --send (or PULLUP_GITHUB_DELIVERY=live) sends them to GitHub",
  )
  .argument("<repoId>", "owner/repo as ingested")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .option("--send", "send the actions to GitHub (needs GITHUB_APP_ID + GITHUB_PRIVATE_KEY or GITHUB_TOKEN)")
  .action(async (repoId: string, opts: { config: string; send?: boolean } & JevCliOpts) => {
    const {
      buildReport,
      planReviewActions,
      approvalGate,
      calibrationPathFor,
      loadCalibration,
      resolveDelivery,
      resolvePermitKey,
      namedModeOf,
      MODE_LABEL,
      ensureAgent,
      governPlan,
    } = await import("@pullup/core");
    const { createReviewActuator, credentialKind } = await import("@pullup/github");
    const delivery = opts.send ? "live" : resolveDelivery();
    const permitKey = resolvePermitKey();
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const cfg = await loadRepoConfig(s, repoId, opts.config);
      const jev = await jevRuntimeFor(s, repoId, cfg, opts);
      const calPath = opts.calibration ?? calibrationPathFor(cfg.jev, repoId);
      const calibration = jev?.calibration ?? (existsSync(calPath) ? loadCalibration(calPath) : null);
      const gate = approvalGate({ repoId, delivery, calibration });
      const report = await buildReport(s, repoId, cfg.priors, { jev, ...configReportOptions(cfg) });
      const planned = planReviewActions(report.decisions, await s.listPulls(repoId), {
        repoId,
        humanReviewers: cfg.jev.humanReviewers,
        authority: cfg.authority,
        configVersion: cfg.version,
        checks: cfg.checks,
        hunks: cfg.checks.enabled ? await s.listHunks(repoId) : [],
        approvalUnlocked: gate.unlocked,
        ...(gate.reason ? { approvalLockedReason: gate.reason } : {}),
      });
      const agent = (await loadIdentities()).cli;
      const now = new Date().toISOString();
      await ensureAgent(s, agent, now);
      const governed = await governPlan(s, planned, {
        repoId,
        initiator: { kind: "cli", ref: operator() },
        agent,
        config: { version: cfg.version, hash: cfg.hash },
        risk: { questionSet: report.risk?.questionSetVersion ?? null, modelId: report.risk?.modelId ?? null },
        delivery,
        credential: credentialKind(),
        permitKey,
        sign: true,
        now,
      });
      const actuator = await createReviewActuator(s, repoId, {
        delivery,
        guard: { permitKey, agent, configHash: async (id) => (await loadRepoConfig(s, id, opts.config)).hash },
      });
      const records = await actuator.apply(governed);
      console.log(JSON.stringify(records, null, 2));
      const count = (st: string) => records.filter((r) => r.status === st).length;
      console.error(
        delivery === "live"
          ? `[actions] mode ${MODE_LABEL[namedModeOf(cfg.authority)]}: sent ${count("sent")} · skipped ${count("skipped")} · denied ${count("denied")} · failed ${count("failed")} · suppressed ${count("suppressed")}. Approval ${gate.unlocked ? "unlocked" : `locked (${gate.reason})`}.`
          : `[actions] mode ${MODE_LABEL[namedModeOf(cfg.authority)]}: logged ${records.length} review action(s); nothing was sent (pass --send or set PULLUP_GITHUB_DELIVERY=live).`,
      );
      const denied = records.find((r) => r.status === "denied");
      if (denied) console.error(`[actions] denied: ${denied.delivery?.denied?.join(" ")}`);
      if (count("failed") > 0) process.exitCode = 1;
    });
  });

// ── Authority layer (Agent Baseline). Operator-only: these run on the host. ──

/** Who is at the keyboard, for the evidence record. */
function operator(): string {
  try {
    return `cli:${userInfo().username}`;
  } catch {
    return "cli";
  }
}

/** This checkout's agent identities (composition hashes). */
async function loadIdentities() {
  const { agentIdentity, eveAgentIdentity, AGENT_IDS } = await import("@pullup/core");
  return {
    cli: agentIdentity({ id: AGENT_IDS.cli }),
    dashboard: agentIdentity({ id: AGENT_IDS.dashboard }),
    eve: eveAgentIdentity(process.cwd()),
  };
}

program
  .command("stop")
  .description("Stop PullUp: deny every new GitHub write and void outstanding permits (globally, or for one repo)")
  .option("-r, --repo <repoId>", "stop only this repo")
  .option("--reason <text>", "why (recorded in evidence)", "")
  .action(async (opts: { repo?: string; reason: string }) => {
    const { stopPullUp } = await import("@pullup/core");
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const st = await stopPullUp(s, { scope: opts.repo, reason: opts.reason, by: operator(), now: new Date().toISOString() });
      console.log(`PullUp is stopped ${st.scope === "global" ? "everywhere" : `on ${st.scope}`}. Resume with: pullup resume${opts.repo ? ` --repo ${opts.repo}` : ""}`);
    });
  });

program
  .command("resume")
  .description("Turn the stop switch off (CLI only — the dashboard can stop but never resume)")
  .option("-r, --repo <repoId>", "resume only this repo")
  .action(async (opts: { repo?: string }) => {
    const { resumePullUp, GLOBAL_SCOPE } = await import("@pullup/core");
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      await resumePullUp(s, { scope: opts.repo, by: operator(), now: new Date().toISOString() });
      const global = await s.getControlState(GLOBAL_SCOPE);
      console.log(`Resumed ${opts.repo ?? "everywhere"}.${opts.repo && global?.stopped ? " Note: PullUp is still stopped globally." : ""}`);
    });
  });

program
  .command("enroll")
  .description("Enroll a repo in a capability profile: observe | review-block-only | review (the most PullUp may send there)")
  .argument("<repoId>", "owner/repo")
  .argument("<profile>", "observe | review-block-only | review")
  .action(async (repoId: string, profile: string) => {
    const { enrollRepo, isCapabilityProfile, CAPABILITY_PROFILES, PROFILE_HINT } = await import("@pullup/core");
    if (!isCapabilityProfile(profile)) throw new Error(`Unknown profile "${profile}". Choose one of: ${CAPABILITY_PROFILES.join(", ")}.`);
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      await enrollRepo(s, { repoId, profile, by: operator(), now: new Date().toISOString() });
      console.log(`${repoId} enrolled in ${profile}: ${PROFILE_HINT[profile]}`);
    });
  });

const agentsCmd = program
  .command("agents")
  .description("Agent registry: list versions (composition hashes), approve one to act, or quarantine one")
  .action(async () => {
    const { ensureAgent, shortVersion } = await import("@pullup/core");
    const ids = await loadIdentities();
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const now = new Date().toISOString();
      // Register this checkout's versions so they can be approved before their first run.
      for (const id of [ids.cli, ids.dashboard, ids.eve]) await ensureAgent(s, id, now);
      const current = new Set([ids.cli.version, ids.dashboard.version, ids.eve.version]);
      for (const a of await s.listAgents()) {
        console.log(
          `${a.status.padEnd(11)} ${a.agentId.padEnd(17)} ${shortVersion(a.version)}  first seen ${a.firstSeen}${a.updatedBy ? ` · ${a.status} by ${a.updatedBy}` : ""}${current.has(a.version) ? "  ← this checkout" : ""}`,
        );
      }
      if (ids.eve.version === "unknown") console.error("[agents] the Eve agent's sources could not be read from ./agent; it will be denied.");
    });
  });

for (const [name, status, help] of [
  ["approve", "approved", "Approve an agent version (hash or ≥6-char prefix) to act"],
  ["quarantine", "quarantined", "Quarantine an agent version: every permit for it is denied"],
] as const) {
  agentsCmd
    .command(name)
    .description(help)
    .argument("<version>", "composition hash or a prefix of at least 6 characters")
    .option("--note <text>", "why (recorded in evidence)", "")
    .action(async (version: string, opts: { note: string }) => {
      const { findAgents, setAgentStatus, shortVersion } = await import("@pullup/core");
      await withStore(program.opts<GlobalOpts>(), async (s) => {
        const matches = await findAgents(s, version);
        if (matches.length === 0) throw new Error(`No agent version matches "${version}" (run \`pullup agents\` to list them).`);
        for (const agent of matches) {
          await setAgentStatus(s, { agent, status, by: operator(), note: opts.note, now: new Date().toISOString() });
          console.log(`${agent.agentId} ${shortVersion(agent.version)} → ${status}`);
        }
      });
    });
}

program
  .command("evidence")
  .description("Show the evidence for one task (WHY · WHAT · RISK · AUTHORITY · ACTION · OUTCOME · VALIDATION · VERSION), or `verify` the hash chain")
  .argument("<taskId|verify>", "a task id, or the word verify")
  .option("-r, --repo <repoId>", "with verify: only this repo's chain")
  .action(async (arg: string, opts: { repo?: string }) => {
    const { evidenceSheet, verifyEvidenceChain } = await import("@pullup/core");
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      if (arg === "verify") {
        const res = verifyEvidenceChain(await s.listEvidence(opts.repo ? { repoId: opts.repo } : {}));
        console.log(res.ok ? `Evidence chain intact (${res.checked} rows).` : `Evidence chain BROKEN (${res.breaks.length} problem(s) in ${res.checked} rows):`);
        for (const b of res.breaks) console.log(`  ${b.repoId} #${b.seq}: ${b.problem}`);
        if (!res.ok) process.exitCode = 1;
        return;
      }
      const sheet = evidenceSheet(arg, await s.listEvidence({ taskId: arg }));
      if (!sheet) throw new Error(`No evidence for task ${arg}.`);
      const { rows, ...sections } = sheet;
      console.log(JSON.stringify({ ...sections, rows: rows.map((r) => `${r.seq} ${r.kind} ${r.at}`) }, null, 2));
    });
  });

program
  .command("impact")
  .description("Every task an agent version ran and what it touched on GitHub (for incident response)")
  .requiredOption("--agent-version <hash>", "composition hash or a prefix of at least 6 characters")
  .action(async (opts: { agentVersion: string }) => {
    const { findAgents, impactOf } = await import("@pullup/core");
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const matches = await findAgents(s, opts.agentVersion);
      if (matches.length === 0) throw new Error(`No agent version matches "${opts.agentVersion}".`);
      for (const a of matches) {
        const rows = impactOf(await s.listEvidence({ agentVersion: a.version }));
        console.log(JSON.stringify({ agent: a.agentId, version: a.version, status: a.status, tasks: rows }, null, 2));
      }
    });
  });

program
  .command("config")
  .description("Show the resolved configuration and provenance (with --repo: including its saved version)")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .option("-r, --repo <repoId>", "layer this repo's latest saved config version on top")
  .action(async (opts: { config: string; repo?: string }) => {
    const { namedModeOf } = await import("@pullup/core");
    const cfg = opts.repo
      ? await withStore(program.opts<GlobalOpts>(), (s) => loadRepoConfig(s, opts.repo!, opts.config))
      : loadConfig(opts.config);
    const out = {
      path: cfg.path,
      version: cfg.version,
      hash: cfg.hash,
      fileOverrides: cfg.fileOverrides,
      mode: namedModeOf(cfg.authority),
      authority: cfg.authority,
      guardrails: cfg.guardrails,
      policy: cfg.policy,
      jev: { ...cfg.jev, weights: undefined },
      reviewFocus: cfg.reviewFocus,
      priors: cfg.priors,
    };
    console.log(JSON.stringify(out, null, 2));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
