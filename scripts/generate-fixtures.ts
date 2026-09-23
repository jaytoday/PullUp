// Generates fixtures/healthy.json and fixtures/congested.json from the core
// generator. Run: pnpm exec tsx scripts/generate-fixtures.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { generateRepo, toFixtureFile } from "@pullup/core/testing";

mkdirSync("fixtures", { recursive: true });

for (const [policy, seed, n] of [
  ["healthy", 42, 120],
  ["congested", 43, 120],
] as const) {
  const file = toFixtureFile(generateRepo({ seed, n, policy }));
  const path = `fixtures/${policy}.json`;
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
  console.log(`wrote ${path} (${file.pulls.length} pulls)`);
}
