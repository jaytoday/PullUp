#!/usr/bin/env node
// PullUp CLI — init / fetch / analyze / report / config, plus the Jev risk
// layer: signals / calibrate / actions, and the authority layer (operator
// only, docs/authority.md): stop / resume / enroll / agents / evidence / impact.

import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { DEFAULT_PRIORS, configReportOptions, loadConfig, loadRepoConfig, resolveQuestionSet } from "@pullup/core";
import type { JevMode, JevRuntime, LintMode, PullSource, ResolvedConfig } from "@pullup/core";
import type { SignalModelKind } from "@pullup/jev";
import { SqliteStore } from "@pullup/db";
import { OctokitPullSource } from "@pullup/github";
import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";
import { lintExitCode } from "./lint-exit.js";
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
  lintMode?: LintMode;
  model?: SignalModelKind;
  replay?: string;
  calibration?: string;
}

/** The lint folder to read on ingest: always for a fixture (free), otherwise only when lint is on. */
function lintRulesDirFor(cfg: ResolvedConfig, fixture: boolean): string | null {
  return fixture || cfg.lint.mode !== "off" ? cfg.lint.dir : null;
}

/** Jev runtime for report-style commands (null when the layer is off). */
async function jevRuntimeFor(
  store: SqliteStore,
  repoId: string,
  cfg: ResolvedConfig,
  opts: JevCliOpts,
): Promise<JevRuntime | undefined> {
  const { prepareJevRuntime } = await import("@pullup/jev");
  const { runtime, run, lintRun } = await prepareJevRuntime(store, repoId, cfg, {
    mode: opts.jevMode,
    lintMode: opts.lintMode,
    kind: opts.model,
    replayPath: opts.replay,
    calibrationPath: opts.calibration,
  });
  if (run) {
    console.error(
      `[jev] ${run.modelId}: ${run.evaluated} evaluated · ${run.cached} cached · ${run.failed} failed · $${run.costUsd}`,
    );
  }
  if (lintRun) {
    console.error(
      `[lint] ${lintRun.modelId}: ${lintRun.evaluated} evaluated · ${lintRun.cached} cached · ${lintRun.failed} failed · $${lintRun.costUsd}`,
    );
  }
  return runtime ?? undefined;
}

function addJevOptions(cmd: Command): Command {
  return cmd
    .option("--jev-mode <mode>", "Jev risk signals: off | shadow (observe) | active (use in decisions); default: config")
    .option("--lint-mode <mode>", "the repo's lint rules: off | observe | on; default: config")
    .option("--model <kind>", "signal model: jev | systemone | synthetic | replay (default: jev if TYPESAFE_API_KEY, systemone if PULLUP_SYSTEMONE_URL)")
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
  .option("-c, --config <path>", "path to pullup.config.json (for the lint rules folder)", "pullup.config.json")
  .action(async (repoId: string, opts: { fixture?: string; config: string }) => {
    const source = await resolveSource(repoId, opts.fixture);
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const { ingestRepo } = await import("@pullup/core");
      const cfg = await loadRepoConfig(s, repoId, opts.config);
      const result = await ingestRepo(source, s, { lintRulesDir: lintRulesDirFor(cfg, Boolean(opts.fixture)) });
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
      const cfg = await loadRepoConfig(s, repoId, opts.config);
      if (source) {
        const { ingestRepo } = await import("@pullup/core");
        await ingestRepo(source, s, { lintRulesDir: lintRulesDirFor(cfg, true) });
      }
      const { buildReport, renderMarkdown, renderJson } = await import("@pullup/core");
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
        if (cfg.lint.mode !== "off") {
          const { runLint, storedLintRuleSet } = await import("@pullup/core");
          const { ruleSet, notes } = await storedLintRuleSet(s, repoId, cfg.lint);
          for (const n of notes) console.error(`[lint] ${n}`);
          if (ruleSet.rules.length > 0) {
            const lintRun = await runLint(s, repoId, model, ruleSet, { pullNumbers, openOnly: opts.openOnly, budgetUsd: cfg.lint.budgetUsdPerRun });
            console.log(JSON.stringify(lintRun, null, 2));
          }
        }
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
  .command("verify")
  .description("Check strong risk-signal findings against the code (evidence verifier; cached by content)")
  .argument("<repoId>", "owner/repo as ingested")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .option("--verifier <kind>", "claude | synthetic (default: claude when ANTHROPIC_API_KEY is set)")
  .option("--jev-mode <mode>", "off | shadow | active (default: config)")
  .option("--pr <numbers...>", "only these pull numbers")
  .action(async (repoId: string, opts: { config: string; verifier?: "claude" | "synthetic"; jevMode?: "off" | "shadow" | "active"; pr?: string[] }) => {
    const { buildReport, runVerification } = await import("@pullup/core");
    const { resolveEvidenceVerifier } = await import("@pullup/verify");
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const cfg = await loadRepoConfig(s, repoId, opts.config);
      if (!cfg.verify.enabled) console.error("[verify] verify.enabled is off: verdicts are stored but not attached to reports until it is on.");
      const jev = await jevRuntimeFor(s, repoId, cfg, opts);
      const report = await buildReport(s, repoId, cfg.priors, { jev, ...configReportOptions(cfg) });
      const { verifier, note } = resolveEvidenceVerifier({ kind: opts.verifier, config: cfg.verify });
      if (note) console.error(`[verify] ${note}`);
      const run = await runVerification(s, repoId, report.decisions, verifier, {
        config: cfg.verify,
        qs: resolveQuestionSet(cfg.jev),
        ...(opts.pr ? { pullNumbers: opts.pr.map(Number) } : {}),
      });
      console.log(JSON.stringify(run, null, 2));
      process.exitCode = run.errors.length > 0 ? 1 : 0;
    });
  });

program
  .command("preview")
  .description("What PullUp would do with the current branch, before you open a pull request (reads git; sends nothing)")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .option("--repo <owner/repo>", "repo id (default: from the origin remote)")
  .option("--base <ref>", "base branch (default: origin's default branch, else main)")
  .option("--head <ref>", "head ref", "HEAD")
  .option("--staged", "preview the staged changes instead of base...head")
  .option("--author <login>", "GitHub login of the author (default: PULLUP_PREVIEW_AUTHOR, else unknown)")
  .option("--label <label...>", "labels the pull request will have")
  .option("--ai", "the change is AI-authored (adds the ai-generated label)")
  .option("--jev-mode <mode>", "off | shadow | active (default: config)")
  .option("--lint-mode <mode>", "the repo's lint rules (read at --base): off | observe | on (default: config)")
  .option("--model <kind>", "signal model: jev | systemone | synthetic | replay")
  .option("--json", "print the versioned JSON result (for coding agents)")
  .option("-v, --verbose", "also print raw signal probabilities")
  .option("--fail-on <what>", "exit 1 when PullUp would: human (ask a human or request changes) | changes (request changes)")
  .action(
    async (opts: {
      config: string;
      repo?: string;
      base?: string;
      head: string;
      staged?: boolean;
      author?: string;
      label?: string[];
      ai?: boolean;
      jevMode?: JevMode;
      lintMode?: LintMode;
      model?: SignalModelKind;
      json?: boolean;
      verbose?: boolean;
      failOn?: "human" | "changes";
    }) => {
      const { approvalGate, buildLintRuleSet, calibrationPathFor, isLintRulePath, loadCalibration, renderPreview, resolveDelivery, runPreview } = await import("@pullup/core");
      const { prepareJevRuntime } = await import("@pullup/jev");
      const git = await import("./git.js");
      const cwd = process.cwd();
      const repoId = opts.repo ?? (await git.originRepoId(cwd));
      if (!repoId) throw new Error("Couldn't tell the repo from the origin remote; pass --repo owner/repo.");
      const base = opts.base ?? (await git.defaultBase(cwd));
      const diff = await git.branchDiff(cwd, { base, head: opts.head, staged: opts.staged });
      if (!diff.trim()) {
        console.error(`[preview] no changes between ${base} and ${opts.head}${opts.staged ? " (staged)" : ""}.`);
        return;
      }
      const headSha = await git.revParse(cwd, opts.head);
      const head = opts.head === "HEAD" ? await git.currentBranch(cwd) : opts.head;
      await withStore(program.opts<GlobalOpts>(), async (s) => {
        const cfg = await loadRepoConfig(s, repoId, opts.config);
        const calPath = calibrationPathFor(cfg.jev, repoId);
        const calibration = existsSync(calPath) ? loadCalibration(calPath) : null;
        const { result } = await runPreview({
          store: s,
          repoId,
          cfg,
          diff,
          base,
          head,
          headSha,
          author: opts.author ?? process.env.PULLUP_PREVIEW_AUTHOR ?? null,
          labels: opts.label ?? [],
          ai: opts.ai,
          approval: approvalGate({ repoId, delivery: resolveDelivery(), calibration }),
          prepareJev: async (store, pullNumbers) => {
            const mode = opts.jevMode ?? cfg.jev.mode;
            const lintMode = opts.lintMode ?? cfg.lint.mode;
            if (mode === "off" && lintMode === "off") return { runtime: null, notes: [] };
            // Lint rules as the base branch has them, as PullUp would read them for the pull request.
            const lintRuleSet =
              lintMode === "off"
                ? undefined
                : buildLintRuleSet({
                    source: "git-ref",
                    ref: base,
                    commitSha: await git.tryRevParse(cwd, base),
                    dir: cfg.lint.dir,
                    files: (await git.filesAtRef(cwd, base, cfg.lint.dir)).filter((f) => isLintRulePath(f.path)),
                  });
            const prepared = await prepareJevRuntime(store, repoId, cfg, { mode, lintMode, ...(lintRuleSet ? { lintRuleSet } : {}), kind: opts.model, pullNumbers: [...pullNumbers] });
            return { runtime: prepared.runtime, notes: [...(prepared.runtime?.notes ?? []), ...(prepared.runtime?.lint?.notes ?? [])] };
          },
        });
        if (opts.json) console.log(JSON.stringify(result, null, 2));
        else {
          console.log(renderPreview(result));
          if (opts.verbose) for (const f of result.findings) console.log(`  ${f.id} ${f.level} ${f.source} ${f.paths.join(", ")}`);
        }
        const action = result.would.action;
        if ((opts.failOn === "human" && (action === "defer_to_human" || action === "request_changes")) || (opts.failOn === "changes" && action === "request_changes")) {
          process.exitCode = 1;
        }
      });
    },
  );

/** Rule files under a local folder (paths relative to it), skipping hidden files and folders. */
function readRulesFolder(dir: string): Array<{ path: string; content: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ path: string; content: string }> = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path);
      else if (e.isFile()) out.push({ path, content: readFileSync(join(dir, path), "utf8") });
    }
  };
  walk("");
  return out;
}

program
  .command("lint")
  .description("Check the branch's changes against the repo's lint rules (Gallant's format) before you push; exits 1 when a rule fails, 2 when the model could not check some file")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .option("--repo <owner/repo>", "repo id, for its saved settings (default: from the origin remote)")
  .option("--base <ref>", "base branch (default: origin's default branch, else main)")
  .option("--head <ref>", "head ref", "HEAD")
  .option("--staged", "check the staged changes instead of base...head")
  .option("--rules <dir>", "rules folder (default: lint.dir from the config, else .agents/gallant)")
  .option("--rules-from <where>", "worktree (your local copy, the default) | base (as the base branch has them, like PullUp on a pull request)", "worktree")
  .option("--model <kind>", "decision model: jev | systemone | synthetic (default: jev if TYPESAFE_API_KEY, systemone if PULLUP_SYSTEMONE_URL)")
  .option("--json", "print the result as JSON")
  .option("--no-fail", "always exit 0 (report only)")
  .action(
    async (opts: {
      config: string;
      repo?: string;
      base?: string;
      head: string;
      staged?: boolean;
      rules?: string;
      rulesFrom: "worktree" | "base";
      model?: SignalModelKind;
      json?: boolean;
      fail: boolean;
    }) => {
      const { buildLintRuleSet, classifyArea, diffHunks, hunkContentHash, lintHunks, parseGitDiff } = await import("@pullup/core");
      const { resolveSignalModel } = await import("@pullup/jev");
      const git = await import("./git.js");
      const cwd = process.cwd();
      if (opts.rulesFrom !== "worktree" && opts.rulesFrom !== "base") throw new Error("--rules-from is worktree or base.");
      const repoId = opts.repo ?? (await git.originRepoId(cwd));
      const base = opts.base ?? (await git.defaultBase(cwd));
      const global = program.opts<GlobalOpts>();
      // Only use the answer cache when a PullUp database is already here: linting shouldn't create one.
      const useStore = program.getOptionValueSource("db") === "cli" || existsSync(global.db ?? "pullup.db");
      const run = async (store: SqliteStore | null) => {
        const cfg = store && repoId ? await loadRepoConfig(store, repoId, opts.config) : loadConfig(opts.config);
        const dir = opts.rules ?? cfg.lint.dir;
        const files =
          opts.rulesFrom === "base" ? await git.filesAtRef(cwd, base, dir) : readRulesFolder(dir);
        const ruleSet = buildLintRuleSet({
          source: opts.rulesFrom === "base" ? "git-ref" : "directory",
          ref: opts.rulesFrom === "base" ? base : null,
          commitSha: opts.rulesFrom === "base" ? await git.tryRevParse(cwd, base) : null,
          dir,
          files,
        });
        for (const p of ruleSet.problems) console.error(`[lint] ${p.path}: ${p.message}`);
        if (ruleSet.rules.length === 0) {
          console.error(`[lint] no usable rules in ${dir}${opts.rulesFrom === "base" ? ` at ${base}` : ""}.`);
          return;
        }
        const diff = await git.branchDiff(cwd, { base, head: opts.head, staged: opts.staged });
        if (!diff.trim()) {
          console.error(`[lint] no changes between ${base} and ${opts.head}${opts.staged ? " (staged)" : ""}.`);
          return;
        }
        const changed = parseGitDiff(diff);
        const hunks = diffHunks(changed).map((h) => ({
          repoId: repoId ?? "local",
          pullNumber: 0,
          path: h.path,
          index: h.index,
          header: h.header,
          patch: h.patch,
          noPatch: h.noPatch ?? false,
          contentHash: hunkContentHash(h),
        }));
        const { model, note } = resolveSignalModel({ kind: opts.model, config: cfg.jev });
        if (note) console.error(`[lint] ${note}`);
        const result = await lintHunks(model, ruleSet, hunks, {
          area: classifyArea({ files: changed.map((f) => f.path) }),
          ...(store ? { cache: store } : {}),
          ...(repoId ? { repoId } : {}),
        });
        if (opts.json) console.log(JSON.stringify({ base, head: opts.head, rulesFrom: opts.rulesFrom, dir, model: model.id, ...result }, null, 2));
        else {
          console.log(
            `pullup lint · ${result.rules} rule(s) · ${result.files} file(s) checked · ${result.failures.length} failing` +
              ` · ${result.evaluated} asked, ${result.cached} cached${result.costUsd > 0 ? ` · $${result.costUsd}` : ""}`,
          );
          for (const f of result.failures) {
            const where = f.lines.map((l) => (l.end > l.start ? `${l.start}-${l.end}` : `${l.start}`)).join(",");
            console.log(`  FAIL ${f.rulePath}  ${f.path}${where ? `:${where}` : ""}  (${f.reason})`);
          }
          if (result.failed > 0) console.log(`  ${result.failed} file part(s) could not be checked (model error), so the check did not pass.`);
          if (result.notEvaluable > 0) console.log(`  ${result.notEvaluable} file part(s) too large or binary, not checked.`);
        }
        process.exitCode = lintExitCode(result, opts.fail);
      };
      if (useStore) await withStore(global, run);
      else await run(null);
    },
  );

program
  .command("lint-rules")
  .description("Show the lint rules PullUp holds for a repo (read from its default branch on ingest), or replace them from a folder or git ref")
  .argument("<repoId>", "owner/repo as ingested")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .option("--from-dir <dir>", "replace the stored rules with the files in this local folder")
  .option("--from-ref <ref>", "replace the stored rules with lint.dir as it is at this git ref in the current repo (such as origin/main)")
  .action(async (repoId: string, opts: { config: string; fromDir?: string; fromRef?: string }) => {
    const { buildLintRuleSet } = await import("@pullup/core");
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const cfg = await loadRepoConfig(s, repoId, opts.config);
      if (opts.fromDir && opts.fromRef) throw new Error("Pass --from-dir or --from-ref, not both.");
      if (opts.fromDir || opts.fromRef) {
        const git = await import("./git.js");
        const cwd = process.cwd();
        await s.setLintRules({
          repoId,
          source: opts.fromDir ? "directory" : "git-ref",
          ref: opts.fromRef ?? null,
          commitSha: opts.fromRef ? await git.tryRevParse(cwd, opts.fromRef) : null,
          dir: cfg.lint.dir,
          files: opts.fromDir ? readRulesFolder(opts.fromDir) : await git.filesAtRef(cwd, opts.fromRef!, cfg.lint.dir),
          fetchedAt: new Date().toISOString(),
        });
      }
      const snap = await s.getLintRules(repoId);
      if (!snap) {
        console.log(`No lint rules stored for ${repoId}. Ingest with lint on (pullup fetch), or pass --from-dir / --from-ref.`);
        return;
      }
      const set = buildLintRuleSet(snap);
      console.log(`${repoId} · ${snap.dir} · ${snap.source}${snap.ref ? ` ${snap.ref}` : ""}${snap.commitSha ? ` @ ${snap.commitSha.slice(0, 7)}` : ""} · read ${snap.fetchedAt} · lint ${cfg.lint.mode}`);
      for (const r of set.rules) console.log(`  ${r.path}  ${r.type}  ${r.appliesTo.join(" ")}  ${(r.level ?? cfg.lint.level).toUpperCase()}`);
      for (const p of set.problems) console.log(`  not used: ${p.path} — ${p.message}`);
      if (set.rules.length === 0 && set.problems.length === 0) console.log("  (no rule files)");
    });
  });

program
  .command("outcomes")
  .description("What humans did after PullUp's decisions, and the learnings PullUp suggests (never applied automatically)")
  .argument("<repoId>", "owner/repo as ingested")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .option("--since <days>", "only decisions from the last N days", "90")
  .option("--json", "print JSON")
  .action(async (repoId: string, opts: { config: string; since: string; json?: boolean }) => {
    const { computeLearnings, deriveOutcomes, summarizeOutcomes } = await import("@pullup/core");
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const cfg = await loadRepoConfig(s, repoId, opts.config);
      const now = new Date().toISOString();
      const cutoff = new Date(Date.parse(now) - Number(opts.since) * 86_400_000).toISOString();
      const outcomes = (await deriveOutcomes(s, repoId, cfg.outcomes, now)).filter((o) => o.decidedAt >= cutoff);
      const summary = summarizeOutcomes(outcomes);
      const learnings = computeLearnings(repoId, outcomes, await s.listLearningDismissals(repoId), now);
      if (opts.json) {
        console.log(JSON.stringify({ summary, learnings, outcomes }, null, 2));
        return;
      }
      console.log(`Outcomes for ${repoId} (last ${opts.since} days): ${outcomes.length} decision(s)`);
      for (const [k, n] of Object.entries(summary.byOutcome)) if (n > 0) console.log(`  ${k.padEnd(24)} ${n}`);
      if (summary.askUnneededRate !== null) console.log(`  sent asks approved unchanged within ${cfg.outcomes.quickApproveMinutes} min: ${Math.round(summary.askUnneededRate * 100)}%`);
      console.log(learnings.length ? "\nLearnings (suggestions only; accept them in the dashboard's Settings):" : "\nNo learnings yet.");
      for (const l of learnings) console.log(`  [${l.id}] ${l.kind}${l.status === "dismissed" ? " (dismissed)" : ""}: ${l.summary}\n      → ${l.suggestion.text}`);
    });
  });

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
        inline: cfg.inline,
        hunks: cfg.checks.enabled || cfg.inline.enabled ? await s.listHunks(repoId) : [],
        findingComments: cfg.inline.enabled ? await s.listFindingComments(repoId) : [],
        questionSet: report.risk?.questionSetVersion ?? null,
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
