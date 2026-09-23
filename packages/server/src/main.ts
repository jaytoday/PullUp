#!/usr/bin/env node
// Starts the PullUp API on loopback. Local tool: no auth — never bind it to a
// public interface. Serves web/dist too when it has been built.

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { loadConfig } from "@pullup/core";
import { SqliteStore, createClient } from "@pullup/db";
import { createApp } from "./app.js";

const root = process.env.PULLUP_ROOT ?? process.cwd();
const dbPath = process.env.PULLUP_DB_PATH ?? resolve(root, "pullup.db");
const configPath = process.env.PULLUP_CONFIG ?? resolve(root, "pullup.config.json");
const port = Number(process.env.PULLUP_API_PORT ?? 4174);
const host = process.env.PULLUP_API_HOST ?? "127.0.0.1";
const staticDir = resolve(root, "web/dist");

const store = new SqliteStore(createClient({ url: `file:${dbPath}` }));
await store.migrate();

const handle = createApp({
  store,
  config: () => loadConfig(configPath),
  now: process.env.PULLUP_NOW ? () => process.env.PULLUP_NOW! : undefined,
  fixturesDir: resolve(root, "fixtures"),
  dataDir: resolve(root, ".pullup"),
  staticDir: existsSync(staticDir) ? staticDir : undefined,
  allowIngest: process.env.NODE_ENV !== "production",
});

createServer((req, res) => void handle(req, res)).listen(port, host, () => {
  console.log(`PullUp API on http://${host}:${port} (db ${dbPath})${existsSync(staticDir) ? " · serving web/dist" : ""}`);
});
