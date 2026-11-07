#!/usr/bin/env node
/**
 * Copy WithAI's typed client into an app.
 *
 * WithAI's client (`packages/client` in the WithAI repository) is the one
 * source. Apps that call WithAI (PullUp, Theory, Squiggle) keep a copy in
 * `packages/withai-client`, because they must not point at another folder on
 * disk. This script refreshes that copy and writes `SYNCED.json` (the client
 * version and a hash of every file). The client's own `synced.test.ts` then
 * fails if anyone edits the copy by hand: change the client in WithAI and sync.
 *
 * Run from the app's root:
 *   WITHAI_REPO=/path/to/withai-eve node scripts/sync-withai-client.mjs
 *   node scripts/sync-withai-client.mjs /path/to/withai-eve
 *
 * The same file lives in WithAI's `scripts/`; keep the copies identical.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repo = process.argv[2] ?? process.env.WITHAI_REPO;
if (!repo) {
  console.error("Say where WithAI is: WITHAI_REPO=/path/to/withai-eve, or pass the path.");
  process.exit(1);
}
const source = resolve(repo, "packages/client");
const target = resolve("packages/withai-client");
if (!existsSync(join(source, "src/index.ts"))) {
  console.error(`No WithAI client at ${source}.`);
  process.exit(1);
}
if (resolve(source) === resolve(target)) {
  console.error("Run this from the app's root, not from WithAI.");
  process.exit(1);
}

// Replace the copied parts only; the app keeps its own tsconfig and test settings.
rmSync(join(target, "src"), { recursive: true, force: true });
cpSync(join(source, "src"), join(target, "src"), { recursive: true });
cpSync(join(source, "package.json"), join(target, "package.json"));

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
const hashes = Object.fromEntries(
  [join(target, "package.json"), ...files(join(target, "src"))]
    .sort()
    .map((file) => [relative(target, file), createHash("sha256").update(readFileSync(file)).digest("hex")]),
);
const { version } = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
writeFileSync(join(target, "SYNCED.json"), `${JSON.stringify({ version, files: hashes }, null, 2)}\n`);
console.log(`Synced @withai/client ${version} (${Object.keys(hashes).length} files) into packages/withai-client.`);
