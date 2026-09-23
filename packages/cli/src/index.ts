#!/usr/bin/env node
// PullUp CLI — init / fetch / analyze / report / config.

import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { DEFAULT_PRIORS, loadConfig } from "@pullup/core";
import type { PullSource } from "@pullup/core";
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

program
  .command("analyze")
  .description("Build and write a report (markdown + JSON) for a repo")
  .argument("<repoId>", "owner/repo as ingested")
  .option("-f, --fixture <path>", "ingest from fixture first (offline)")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .option("-o, --out <dir>", "output directory", "pullup-out")
  .action(async (repoId: string, opts: { fixture?: string; config: string; out: string }) => {
    const source = opts.fixture ? await resolveSource(repoId, opts.fixture) : null;
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      if (source) {
        const { ingestRepo } = await import("@pullup/core");
        await ingestRepo(source, s);
      }
      const { buildReport, renderMarkdown, renderJson } = await import("@pullup/core");
      const cfg = loadConfig(opts.config);
      const report = await buildReport(s, repoId, cfg.priors);
      const md = renderMarkdown(report);
      const json = renderJson(report);
      mkdirSync(opts.out, { recursive: true });
      writeFileSync(`${opts.out}/${repoId.replace("/", "__")}.md`, md);
      writeFileSync(`${opts.out}/${repoId.replace("/", "__")}.json`, json);
      console.log(`wrote ${opts.out}/${repoId.replace("/", "__")}.md/.json`);
    });
  });

program
  .command("report")
  .description("Print the markdown report for a repo to stdout")
  .argument("<repoId>", "owner/repo as ingested")
  .option("-c, --config <path>", "path to pullup.config.json", "pullup.config.json")
  .action(async (repoId: string, opts: { config: string }) => {
    await withStore(program.opts<GlobalOpts>(), async (s) => {
      const { buildReport, renderMarkdown } = await import("@pullup/core");
      const cfg = loadConfig(opts.config);
      const report = await buildReport(s, repoId, cfg.priors);
      console.log(renderMarkdown(report));
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
