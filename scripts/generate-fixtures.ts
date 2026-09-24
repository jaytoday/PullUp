// Generates the bundled fixtures from the core generator.
// Run: pnpm exec tsx scripts/generate-fixtures.ts [--regenerate]
//
// healthy/congested: existing files are *augmented* with synthetic diff hunks
// (their own PRNG stream), so every other field — and every report computed
// from them — stays byte-identical. `--regenerate` rebuilds them from scratch.
// calibration/jev: pinned `now`, so they are reproducible byte-for-byte.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { FixtureFile } from "@pullup/core";
import { generateRepo, scenarioPulls, toFixtureFile, withSyntheticHunks } from "@pullup/core/testing";

const regenerate = process.argv.includes("--regenerate");
const PINNED_NOW = "2026-09-01T00:00:00.000Z";

mkdirSync("fixtures", { recursive: true });

function write(name: string, file: FixtureFile): void {
  const path = `fixtures/${name}.json`;
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
  console.log(`wrote ${path} (${file.pulls.length} pulls)`);
}

function stripHunks(file: FixtureFile): FixtureFile {
  return { ...file, pulls: file.pulls.map(({ hunks: _h, ...p }) => p) };
}

for (const [policy, seed, n] of [
  ["healthy", 42, 120],
  ["congested", 43, 120],
] as const) {
  const path = `fixtures/${policy}.json`;
  const base: FixtureFile =
    existsSync(path) && !regenerate
      ? stripHunks(JSON.parse(readFileSync(path, "utf8")) as FixtureFile)
      : toFixtureFile(generateRepo({ seed, n, policy }));
  write(policy, withSyntheticHunks(base, seed));
}

// Large labelled history for `pullup calibrate` (promotion-gate sized).
write(
  "calibration",
  withSyntheticHunks(
    toFixtureFile(generateRepo({ seed: 44, n: 600, policy: "healthy", repoName: "calibration", now: PINNED_NOW })),
    44,
  ),
);

// Small repo + hand-built open PRs covering every Jev band (policy escalation,
// injection, docs fast path, auth signal, formatting-only).
const jevBase = withSyntheticHunks(
  toFixtureFile(generateRepo({ seed: 45, n: 40, policy: "healthy", repoName: "jev", now: PINNED_NOW })),
  45,
);
write("jev", { ...jevBase, pulls: [...jevBase.pulls, ...scenarioPulls(PINNED_NOW)] });
