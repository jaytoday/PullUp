import type { CiRun, Concern, ConfigInput } from "@pullup/engine";
import { seeded } from "@pullup/engine/testing";

/**
 * Synthetic pull requests for the demo and the tests. Every record is marked
 * `synthetic: true` and its label is the generator's ground truth, not a
 * measurement of anything real. Same seed, same data.
 *
 * Each pull request carries one main concern (sometimes two), drawn from the
 * patterns in plans page 06: flaky retries that are the environment (safe) or
 * a real race (risky); tests deleted with their feature (safe) or loosened
 * next to a behavior change (risky); sensitive changes that only log or add
 * an index (safe) or change a session lifetime, drop a permission check or
 * drop a column (risky). About 15% are "hard": the wording points the wrong
 * way, so cheap models get them wrong more often.
 */

export const SYNTHETIC_REPO = "acme/shop";
export const SYNTHETIC_CONFIG: ConfigInput = {
  requiredWorkflows: ["ci"],
  flaky: { knownTests: ["checkout.spec.ts > shows confirmation", "search.spec.ts > suggests results"] },
  reviewers: ["sam-reviewer"],
};

export interface SyntheticPull {
  id: string;
  synthetic: true;
  split: "tune" | "holdout" | "hard";
  run: CiRun & { pull: { number: number; title: string; body: string; labels: string[]; author: string } };
  truth: Partial<Record<Concern, "risky" | "safe">>;
  reason: Partial<Record<Concern, string>>;
}

type Rand = () => number;
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function fileDiff(path: string, change: { status?: "added" | "deleted" | "modified"; removed?: string[]; added?: string[] }): string {
  const removed = change.removed ?? [];
  const added = change.added ?? [];
  const status = change.status ?? "modified";
  const from = status === "added" ? "/dev/null" : `a/${path}`;
  const to = status === "deleted" ? "/dev/null" : `b/${path}`;
  const header = `@@ -${status === "added" ? 0 : 1},${removed.length} +${status === "deleted" ? 0 : 1},${added.length} @@`;
  return [`--- ${from}`, `+++ ${to}`, header, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)].join("\n") + "\n";
}

const ok = { conclusion: "success" as const };
const testJob = (attempts: Array<{ conclusion: "success" | "failure"; failedTests?: string[]; logExcerpt?: string }>) => [
  { workflow: "ci", name: "build", attempts: [ok] },
  { workflow: "ci", name: "test", attempts },
];

const AREAS = ["cart", "orders", "search", "profile", "inventory", "checkout", "billing-ui", "reports"];
const AUTHORS = ["alice", "bao", "carmen", "dev", "eli", "fatima", "gus"];

/** A plain code change outside every sensitive path, so it adds no concern of its own. */
function routineCode(r: Rand, area: string): string {
  const n = int(r, 2, 40);
  return fileDiff(`src/${area}/view.tsx`, { removed: [`  const pageSize = ${n};`], added: [`  const pageSize = ${n + 10};`] });
}

type Template = (r: Rand) => { concern: Concern; label: "risky" | "safe"; hard: boolean; title: string; body: string; diff: string; jobs: ReturnType<typeof testJob>; reason: string; extra?: Partial<Record<Concern, "risky" | "safe">> };

const flakyEnvironment: Template = (r) => {
  const area = pick(r, AREAS);
  const test = `${area}.spec.ts > ${pick(r, ["loads the list", "saves a draft", "shows totals", "paginates"])}`;
  const log = pick(r, [
    `ECONNRESET while calling the test database (attempt 1 of 1)`,
    `Error: socket hang up\n    at TLSSocket.onConnectEnd (node:_tls_wrap:1600:19)`,
    `Timeout of 5000ms exceeded waiting for the browser to start (selenium grid busy)`,
    `npm ERR! 429 Too Many Requests - GET https://registry.npmjs.org/left-pad`,
  ]);
  return { concern: "flaky_retry", label: "safe", hard: false, title: `Tidy the ${area} page`, body: `Small layout change on the ${area} page.`, diff: routineCode(r, area), jobs: testJob([{ conclusion: "failure", failedTests: [test], logExcerpt: log }, ok]), reason: "The first attempt failed on the test environment, not the code; the rerun passed." };
};

const flakyRace: Template = (r) => {
  const area = pick(r, ["orders", "inventory", "cart"]);
  const n = int(r, 2, 9);
  return {
    concern: "flaky_retry",
    label: "risky",
    hard: false,
    title: `Process ${area} updates in parallel`,
    body: `Speeds up ${area} sync by running updates at the same time.`,
    diff: fileDiff(`src/${area}/sync.ts`, { removed: ["  for (const u of updates) await apply(u);"], added: ["  await Promise.all(updates.map((u) => apply(u)));"] }),
    jobs: testJob([{ conclusion: "failure", failedTests: [`${area}.spec.ts > keeps counts consistent`], logExcerpt: `AssertionError: expected ${n} ${area} rows, received ${n - 1}\n    at sync.spec.ts:41` }, ok]),
    reason: "The change made updates concurrent and the failure is a lost update: a real race that passed by luck on the rerun.",
  };
};

const flakyHiddenRace: Template = (r) => {
  const area = pick(r, ["orders", "inventory"]);
  return {
    concern: "flaky_retry",
    label: "risky",
    hard: true,
    title: `Retry ${area} writes on timeout`,
    body: "Adds a retry around the database write. Test flaked once, known issue.",
    diff: fileDiff(`src/${area}/write.ts`, { removed: ["  await db.write(row);"], added: ["  await retry(() => db.write(row), { attempts: 3 });"] }),
    jobs: testJob([{ conclusion: "failure", failedTests: [`${area}.spec.ts > writes once`], logExcerpt: "Timeout of 2000ms exceeded. (duplicate key value violates unique constraint)" }, ok]),
    reason: "The log looks like a timeout, but the duplicate key shows the new retry writes twice.",
  };
};

const flakyEnvironmentLooksBad: Template = (r) => {
  const area = pick(r, AREAS);
  return {
    concern: "flaky_retry",
    label: "safe",
    hard: true,
    title: `Copy edits on ${area}`,
    body: "Text only.",
    diff: routineCode(r, area),
    jobs: testJob([{ conclusion: "failure", failedTests: [`${area}.spec.ts > renders`], logExcerpt: "AssertionError: expected connection to be open, but the test database container was restarting" }, ok]),
    reason: "An assertion message, but about the test database restarting: the environment.",
  };
};

const testsWithFeature: Template = (r) => {
  const feature = pick(r, ["csv-export", "legacy-coupons", "old-search", "beta-banner", "fax-receipts"]);
  return {
    concern: "deleted_tests",
    label: "safe",
    hard: false,
    title: `Remove ${feature}`,
    body: `Removes the ${feature} feature, deprecated since v3 and unused for six months.`,
    diff:
      fileDiff(`src/${feature}/index.ts`, { status: "deleted", removed: [`export function ${feature.replace(/-./g, (m) => m[1]!.toUpperCase())}() {`, "  return run();", "}"] }) +
      fileDiff(`src/${feature}/index.test.ts`, { status: "deleted", removed: [`describe("${feature}", () => {`, "  it(\"runs\", () => expect(run()).toBe(true));", "});"] }),
    jobs: testJob([ok]),
    reason: "The tests were deleted together with the feature they covered.",
  };
};

const loosenedAssertion: Template = (r) => {
  const area = pick(r, ["cart", "billing-ui", "reports"]);
  const total = int(r, 1000, 9000);
  return {
    concern: "deleted_tests",
    label: "risky",
    hard: false,
    title: `Fix rounding in ${area} totals`,
    body: "Rounding fix. Updated the test that broke.",
    diff:
      fileDiff(`src/${area}/total.ts`, { removed: ["  return Math.round(sum * 100) / 100;"], added: ["  return Math.floor(sum);"] }) +
      fileDiff(`src/${area}/total.test.ts`, { removed: [`  expect(total(items)).toBe(${total / 100});`, "  expect(total([])).toBe(0);"], added: ["  expect(total(items)).toBeGreaterThan(0);"] }),
    jobs: testJob([ok]),
    reason: "The assertion was loosened in the same change that altered the behavior it checked.",
  };
};

const skippedToPass: Template = (r) => {
  const area = pick(r, ["checkout", "orders"]);
  return {
    concern: "deleted_tests",
    label: "risky",
    hard: false,
    title: `Unblock ${area} release`,
    body: "Skipping a test that keeps failing, will fix later.",
    diff:
      fileDiff(`src/${area}/flow.ts`, { removed: ["  if (!cart.items.length) return null;"], added: ["  // empty carts are handled upstream"] }) +
      fileDiff(`src/${area}/flow.test.ts`, { removed: ['  it("refuses an empty cart", () => {'], added: ['  it.skip("refuses an empty cart", () => {'] }),
    jobs: testJob([{ conclusion: "failure", failedTests: [`${area}/flow.test.ts > refuses an empty cart`], logExcerpt: "Expected null, received [object Object]" }, ok]),
    reason: "The rerun passed only because the failing test was skipped, and the change removed the check it covered.",
    extra: { flaky_retry: "risky" },
  };
};

const snapshotRefresh: Template = (r) => {
  const area = pick(r, AREAS);
  return {
    concern: "deleted_tests",
    label: "safe",
    hard: true,
    title: `New ${area} button style`,
    body: "Design refresh; snapshots updated for the new button color.",
    diff: fileDiff(`src/${area}/button.tsx`, { removed: ['  color: "blue",'], added: ['  color: "teal",'] }) + fileDiff(`src/${area}/__snapshots__/button.test.tsx.snap`, { removed: ['  "color": "blue",'], added: ['  "color": "teal",'] }),
    jobs: testJob([ok]),
    reason: "Snapshots rewritten, but only for an intended color change.",
  };
};

const authLogging: Template = (r) => {
  const what = pick(r, ['  logger.debug("session refreshed", { userId });', "  // Sessions refresh on every request; see docs/sessions.md.", '  metrics.increment("auth.login.success");']);
  return { concern: "sensitive_change", label: "safe", hard: false, title: "Add a log line to session refresh", body: "Observability only.", diff: fileDiff("src/auth/session.ts", { added: [what] }), jobs: testJob([ok]), reason: "Logging or a comment in sign-in code; behavior is unchanged." };
};

const sessionLifetime: Template = (r) => {
  const days = int(r, 7, 90);
  return {
    concern: "sensitive_change",
    label: "risky",
    hard: false,
    title: "Keep people signed in longer",
    body: "Users asked to stay signed in.",
    diff: fileDiff("src/auth/session.ts", { removed: ["const SESSION_TTL_SECONDS = 3600;"], added: [`const SESSION_TTL_SECONDS = 86400 * ${days};`] }),
    jobs: testJob([ok]),
    reason: "The session lifetime grew from one hour to days: a security change that needs an owner's sign-off.",
  };
};

const permissionRemoved: Template = (r) => {
  const area = pick(r, ["refunds", "users", "exports"]);
  return {
    concern: "sensitive_change",
    label: "risky",
    hard: false,
    title: `Simplify ${area} handler`,
    body: "Cleanup.",
    diff: fileDiff(`src/permissions/${area}.ts`, { removed: ["  if (!user.isAdmin) throw new ForbiddenError();", "  return handle(req);"], added: ["  return handle(req);"] }),
    jobs: testJob([ok]),
    reason: "A permission check was removed.",
  };
};

const migrationIndex: Template = (r) => {
  const n = int(r, 10, 99);
  return { concern: "sensitive_change", label: "safe", hard: false, title: "Index orders by user", body: "Speeds up the orders page.", diff: fileDiff(`db/migrations/00${n}_orders_user_index.sql`, { status: "added", added: ["CREATE INDEX CONCURRENTLY orders_user ON orders(user_id);"] }), jobs: testJob([ok]), reason: "An added index is easy to undo and changes no data." };
};

const migrationDrop: Template = (r) => {
  const n = int(r, 10, 99);
  const col = pick(r, ["email_verified", "legacy_id", "tax_region"]);
  return { concern: "sensitive_change", label: "risky", hard: false, title: `Drop ${col}`, body: "Column is unused.", diff: fileDiff(`db/migrations/00${n}_drop_${col}.sql`, { status: "added", added: [`ALTER TABLE users DROP COLUMN ${col};`] }), jobs: testJob([ok]), reason: "Dropping a column destroys data and cannot be rolled back." };
};

const quietTtlChange: Template = (r) => {
  const hours = int(r, 24, 720);
  return {
    concern: "sensitive_change",
    label: "risky",
    hard: true,
    title: "Refactor session helper",
    body: "No behavior change, just moving constants around.",
    diff: fileDiff("src/auth/cookies.ts", { removed: ["export const MAX_AGE = 60 * 60;"], added: [`export const MAX_AGE = 60 * 60 * ${hours};`] }),
    jobs: testJob([ok]),
    reason: "Described as a refactor, but the cookie lifetime grew from one hour.",
  };
};

const scaryLookingSafe: Template = () => ({
  concern: "sensitive_change",
  label: "safe",
  hard: true,
  title: "Fix typo in permission error",
  body: "Typo fix.",
  diff: fileDiff("src/permissions/messages.ts", { removed: ['  forbidden: "You do not have permision to do this.",'], added: ['  forbidden: "You do not have permission to do this.",'] }),
  jobs: testJob([ok]),
  reason: "A typo in an error message inside the permissions folder.",
});

/** Weighted so that about 75% of concerns are safe and about 15% of pull requests are hard. */
const TEMPLATES: Array<[Template, number]> = [
  [flakyEnvironment, 16],
  [flakyRace, 4],
  [flakyHiddenRace, 2],
  [flakyEnvironmentLooksBad, 3],
  [testsWithFeature, 13],
  [loosenedAssertion, 4],
  [skippedToPass, 2],
  [snapshotRefresh, 3],
  [authLogging, 14],
  [sessionLifetime, 3],
  [permissionRemoved, 3],
  [migrationIndex, 13],
  [migrationDrop, 2],
  [quietTtlChange, 2],
  [scaryLookingSafe, 3],
];

export function generatePulls(count = 360, seed = 20261115): SyntheticPull[] {
  const r = seeded(seed);
  const total = TEMPLATES.reduce((s, [, w]) => s + w, 0);
  const choose = () => {
    let x = r() * total;
    for (const [t, w] of TEMPLATES) if ((x -= w) < 0) return t;
    return TEMPLATES[0]![0];
  };
  return Array.from({ length: count }, (_, i) => {
    const t = choose()(r);
    const number = 1000 + i;
    const id = `pr-${String(i + 1).padStart(4, "0")}`;
    return {
      id,
      synthetic: true as const,
      // Hard cases are scored apart; the rest is split for fitting and scoring.
      split: t.hard ? "hard" : r() < 0.4 ? "tune" : "holdout",
      run: { repo: SYNTHETIC_REPO, headSha: `${id.replace("pr-", "c0ffee")}${number.toString(16)}`, jobs: t.jobs, diff: t.diff, pull: { number, title: t.title, body: t.body, labels: [], author: pick(r, AUTHORS) } },
      truth: { [t.concern]: t.label, ...(t.extra ?? {}) },
      reason: { [t.concern]: t.reason },
    };
  });
}
