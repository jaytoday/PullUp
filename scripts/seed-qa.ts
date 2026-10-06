// Seeds a SQLite DB with a realistic repo for hands-on QA of the dashboard:
// ~220 PRs of generated history (relative to *now*, so waits look real; a low
// defect rate, so the cost model has room to approve), the Jev scenario PRs, and hand-built open PRs that exercise each settings feature
// (billing folder, dependency changes, a trusted bot, a large refactor, an
// AI-labelled PR without tests, docs-only, a feature with tests). Then it runs
// synthetic signals on every PR and writes a calibration artifact.
//
// Run: pnpm exec tsx scripts/seed-qa.ts [repoId] [dbPath]
//   defaults: jaytoday/pullup, .pullup/qa.db  (serve it with PULLUP_DB_PATH)

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { calibrateRepo, ingestRepo, loadConfig, resolveQuestionSet, runSignals } from "@pullup/core";
import type { FixtureFile } from "@pullup/core";
import { SyntheticSignalModel, generateRepo, scenarioPulls, sourceFromFixtureFile, toFixtureFile, withSyntheticHunks } from "@pullup/core/testing";
import { SqliteStore, createClient } from "@pullup/db";

const repoId = process.argv[2] ?? "jaytoday/pullup";
const dbPath = process.argv[3] ?? ".pullup/qa.db";
const [owner, repo] = repoId.split("/") as [string, string];
const now = new Date().toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

type Pull = FixtureFile["pulls"][number];
type Hunk = NonNullable<Pull["hunks"]>[number];

function pr(
  number: number,
  title: string,
  author: string,
  ageHours: number,
  files: string[],
  hunks: Hunk[],
  size: [number, number],
  labels: string[] = [],
): Pull {
  return {
    number,
    title,
    author,
    createdAt: hoursAgo(ageHours),
    closedAt: null,
    mergedAt: null,
    state: "open",
    baseBranch: "main",
    headSha: `qa${String(number).padStart(14, "0")}`,
    additions: size[0],
    deletions: size[1],
    changedFiles: files.length,
    labels,
    draft: false,
    files,
    hunks,
    reviews: [],
    reviewComments: [],
    defectEvents: [],
  };
}

const h = (path: string, patch: string, index = 0): Hunk => ({ path, index, header: "@@ -1,6 +1,8 @@", patch });

/** Hand-built open PRs, one per settings feature worth poking at. */
const qaPulls: Pull[] = [
  pr(2001, "Rework invoice rounding", "alice", 5, ["src/billing/invoice.ts"], [
    h("src/billing/invoice.ts", "   export function total(lines: Line[]) {\n-  return lines.reduce((s, l) => s + l.amount, 0);\n+  const raw = lines.reduce((s, l) => s + l.amount, 0);\n+  return Math.round(raw * 100) / 100;\n   }"),
  ], [38, 6], ["billing"]),
  pr(2002, "Add left-pad, bump zod to v4", "carol", 4, ["package.json", "pnpm-lock.yaml"], [
    h("package.json", '   "dependencies": {\n+    "left-pad": "^1.3.0",\n-    "zod": "^3.23.0",\n+    "zod": "^4.4.3",\n     "drizzle-orm": "^0.45.2"'),
    h("pnpm-lock.yaml", "-  zod@3.23.0:\n-    resolution: {integrity: sha512-aaa}\n+  zod@4.4.3:\n+    resolution: {integrity: sha512-bbb}\n+  left-pad@1.3.0:\n+    resolution: {integrity: sha512-ccc}"),
  ], [24, 8], ["dependencies"]),
  pr(2003, "Bump vitest from 2.1.8 to 2.1.9", "renovate[bot]", 26, ["package.json", "pnpm-lock.yaml"], [
    h("package.json", '   "devDependencies": {\n-    "vitest": "^2.1.8",\n+    "vitest": "^2.1.9",\n     "typescript": "^5.9.3"'),
    h("pnpm-lock.yaml", "-  vitest@2.1.8:\n-    resolution: {integrity: sha512-ddd}\n+  vitest@2.1.9:\n+    resolution: {integrity: sha512-eee}"),
  ], [6, 6], ["dependencies"]),
  pr(
    2004,
    "Refactor scheduler into smaller modules",
    "dave",
    30,
    Array.from({ length: 12 }, (_, i) => `src/core/scheduler/part${i + 1}.ts`),
    Array.from({ length: 12 }, (_, i) =>
      h(`src/core/scheduler/part${i + 1}.ts`, `+export function step${i + 1}(q: Queue) {\n+  return q.next();\n+}\n-// moved from scheduler.ts`),
    ),
    [520, 180],
    ["refactor"],
  ),
  pr(2005, "Add retry helper for webhooks", "erin", 6, ["src/api/webhooks/retry.ts"], [
    h("src/api/webhooks/retry.ts", "+export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {\n+  for (let i = 0; ; i++) {\n+    try { return await fn(); } catch (e) { if (i >= tries) throw e; }\n+  }\n+}"),
  ], [180, 0], ["ai-generated"]),
  pr(2006, "Clarify setup steps in README", "bob", 2, ["README.md", "docs/setup.md"], [
    h("README.md", " ## Setup\n-Run the install script.\n+Run `pnpm install`, then `pnpm build`."),
    h("docs/setup.md", " ### Database\n-Create the DB manually.\n+The DB is created on first run."),
  ], [4, 2], ["documentation"]),
  pr(2007, "Add CSV export endpoint", "alice", 20, ["src/api/export.ts", "src/api/export.test.ts"], [
    h("src/api/export.ts", "+export function toCsv(rows: Row[]): string {\n+  return rows.map((r) => [r.id, r.name].join(\",\")).join(\"\\n\");\n+}"),
    h("src/api/export.test.ts", "+it(\"exports rows\", () => {\n+  expect(toCsv([{ id: 1, name: \"a\" }])).toBe(\"1,a\");\n+});"),
  ], [60, 0], ["enhancement"]),
  pr(2008, "Tighten session cookie flags", "carol", 3, ["src/auth/session.ts"], [
    h("src/auth/session.ts", "   res.cookie(\"sid\", token, {\n-    httpOnly: false,\n+    httpOnly: true,\n+    sameSite: \"strict\",\n   });"),
  ], [4, 1], ["security"]),
];

async function main() {
  const base = withSyntheticHunks(toFixtureFile(generateRepo({ seed: 2026, n: 220, days: 120, defectPrior: 0.05, policy: "healthy", repoName: repo, now })), 2026);
  const file: FixtureFile = {
    repo: { ...base.repo, owner, repo },
    pulls: [...base.pulls, ...scenarioPulls(now), ...qaPulls],
  };

  rmSync(dbPath, { force: true });
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteStore(createClient({ url: `file:${dbPath}` }));
  await store.migrate();
  const ingested = await ingestRepo(sourceFromFixtureFile(file, repoId), store, { now });
  console.log(`ingested ${repoId}: ${ingested.pulls} pulls (${ingested.mergedPulls} merged), ${ingested.reviews} reviews`);

  const cfg = loadConfig("pullup.config.json");
  const qs = resolveQuestionSet(cfg.jev);
  const model = new SyntheticSignalModel();
  const run = await runSignals(store, repoId, model, qs, { now });
  console.log(`signals: ${run.evaluated} units evaluated (${model.id})`);

  const artifact = await calibrateRepo(store, repoId, cfg.priors, qs, model.id, { policy: cfg.policy, config: cfg.jev, now });
  const calPath = join(dirname(dbPath), `calibration.${repoId.replace("/", "__")}.json`);
  writeFileSync(calPath, JSON.stringify(artifact, null, 2) + "\n");
  console.log(`calibration ${artifact.hash} → ${calPath} (gate ${artifact.gate.passed ? "passed" : "failed"})`);
}

await main();
