// Guardrail evaluation — deterministic facts about one PR against the
// configured envelope (config/guardrails.ts). Runs regardless of the Jev mode:
// the cost model can recommend auto-approve with the Jev layer off, so the
// envelope has to hold there too.

import type { ApprovableTier, GuardrailsConfig, Tier } from "../config/guardrails.js";
import { TIERS } from "../config/guardrails.js";
import type { AppliedRule, ReviewRule, ScopedPolicy } from "../config/rules.js";
import { applyRules, basePolicy } from "../config/rules.js";
import type { SeverityConfig } from "../config/severity.js";
import { DEFAULT_SEVERITY } from "../config/severity.js";
import type { RuleFindingInput } from "../findings/findings.js";
import type { HunkRecord, PullRecord } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";
import { categoryForGlob } from "./categories.js";
import type { PolicyRules } from "./policy.js";
import { evaluatePolicy, matchesAny } from "./policy.js";

export type DependencyChangeKind = "new" | "removed" | "major" | "minor" | "patch" | "unknown";

export interface DependencyChange {
  readonly name: string;
  readonly path: string;
  readonly section: "dev" | "runtime";
  readonly kind: DependencyChangeKind;
  readonly from: string | null;
  readonly to: string | null;
}

export interface GuardrailResult {
  readonly pullNumber: number;
  readonly tier: Tier;
  /** Lines changed after excluding generated/vendored/lockfile paths. */
  readonly lines: number;
  readonly linesExcluded: number;
  readonly files: number;
  readonly aiAuthored: boolean;
  readonly firstTimeContributor: boolean;
  readonly dependencyChanges: readonly DependencyChange[];
  /** Category hits: a human must review (escalate). */
  readonly requireHuman: readonly string[];
  /** The bot may not approve (defers to a human once w* passes). */
  readonly approveBlockers: readonly string[];
  readonly notes: readonly string[];
  /** Rule-backed findings (tests missing…), levelled by the severity policy. */
  readonly ruleFindings: readonly RuleFindingInput[];
  /** This PR's policy after scoped rules. */
  readonly scope: ScopedPolicy;
  readonly appliedRules: readonly AppliedRule[];
}

export interface GuardrailInput {
  readonly pull: Pick<PullRecord, "number" | "author" | "createdAt" | "additions" | "deletions" | "files" | "labels">;
  readonly hunks: readonly HunkRecord[];
  /** Effective policy (category globs compiled in). */
  readonly policy: PolicyRules;
  readonly config: GuardrailsConfig;
  /** True when the author had a merged PR before this one was opened. */
  readonly authorHasMergedBefore: boolean;
  readonly now: string;
  readonly rules?: readonly ReviewRule[];
  readonly severity?: SeverityConfig;
}

const TIER_RANK: Readonly<Record<Tier, number>> = Object.fromEntries(TIERS.map((t, i) => [t, i])) as Record<Tier, number>;

export function tierRank(t: Tier): number {
  return TIER_RANK[t];
}

/** Tier of one path: critical > high > low > trivial > standard (unmatched). */
export function tierOfPath(path: string, policy: PolicyRules, cfg: GuardrailsConfig): Tier {
  if (matchesAny(path, policy.requireHumanGlobs)) return "critical";
  if (matchesAny(path, cfg.tiers.high)) return "high";
  if (matchesAny(path, cfg.tiers.low)) return "low";
  const trivial = [...policy.allowlist.docs, ...policy.allowlist.test];
  if (matchesAny(path, trivial)) return "trivial";
  return "standard";
}

function countChangedLines(patch: string): number {
  let n = 0;
  for (const line of patch.split("\n")) {
    if ((line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---")) n += 1;
  }
  return n;
}

function simpleGlob(pattern: string, value: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
  return re.test(value);
}

const DEP_SECTIONS: Readonly<Record<string, "dev" | "runtime">> = {
  dependencies: "runtime",
  peerDependencies: "runtime",
  optionalDependencies: "runtime",
  devDependencies: "dev",
};
const VERSIONISH = /^(?:[~^<>=]*\s*v?\d|workspace:|npm:|\*$|latest$|next$|file:|link:|git\+|github:)/;

function parseVersion(range: string): [number, number, number] | null {
  const m = range.match(/(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/);
  if (!m) return null;
  const n = (s: string | undefined) => (s === undefined || s === "x" || s === "*" ? 0 : Number(s));
  return [n(m[1]), n(m[2]), n(m[3])];
}

function bumpKind(from: string, to: string): DependencyChangeKind {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (!a || !b) return "unknown";
  if (a[0] !== b[0]) return "major";
  // 0.x: a minor bump is breaking by semver convention.
  if (a[1] !== b[1]) return a[0] === 0 ? "major" : "minor";
  return "patch";
}

/**
 * Dependency changes from package.json hunks. Section context is tracked
 * through each hunk; an entry whose section isn't visible counts as runtime
 * (the conservative guess).
 */
export function dependencyChanges(hunks: readonly HunkRecord[]): DependencyChange[] {
  const removed = new Map<string, { path: string; section: "dev" | "runtime"; version: string }>();
  const added = new Map<string, { path: string; section: "dev" | "runtime"; version: string }>();
  for (const h of hunks) {
    if (!/(^|\/)package\.json$/.test(h.path) || h.noPatch) continue;
    let section: "dev" | "runtime" | "other" | null = null;
    for (const raw of h.patch.split("\n")) {
      const sign = raw[0];
      const line = raw.slice(1);
      const open = line.match(/^\s*"([A-Za-z]+)"\s*:\s*\{/);
      if (open) {
        section = DEP_SECTIONS[open[1]!] ?? "other";
        continue;
      }
      if (/^\s*}/.test(line)) {
        section = null;
        continue;
      }
      if (sign !== "+" && sign !== "-") continue;
      const entry = line.match(/^\s*"([^"]+)"\s*:\s*"([^"]*)"/);
      if (!entry) continue;
      const [, name, version] = entry as unknown as [string, string, string];
      if (section === "other") continue;
      if (section === null && !VERSIONISH.test(version)) continue;
      const rec = { path: h.path, section: section ?? "runtime", version };
      (sign === "+" ? added : removed).set(`${h.path}::${name}`, rec);
    }
  }
  const out: DependencyChange[] = [];
  const names = new Set([...added.keys(), ...removed.keys()]);
  for (const key of [...names].sort()) {
    const name = key.slice(key.indexOf("::") + 2);
    const a = added.get(key);
    const r = removed.get(key);
    if (a && r) {
      if (a.version === r.version && a.section === r.section) continue;
      // Moving from devDependencies into dependencies ships it to production.
      const section = a.section === "runtime" || r.section === "runtime" ? "runtime" : "dev";
      out.push({ name, path: a.path, section, kind: bumpKind(r.version, a.version), from: r.version, to: a.version });
    } else if (a) {
      out.push({ name, path: a.path, section: a.section, kind: "new", from: null, to: a.version });
    } else if (r) {
      out.push({ name, path: r.path, section: r.section, kind: "removed", from: r.version, to: null });
    }
  }
  return out;
}

export function isAiAuthored(pull: Pick<PullRecord, "author" | "labels">, cfg: GuardrailsConfig): boolean {
  if (pull.labels.some((l) => /^(ai-generated|ai-assisted|ai)$/i.test(l))) return true;
  return cfg.authors.aiAuthors.some((p) => simpleGlob(p, pull.author));
}

function scaled(limit: number | null, mult: number): number | null {
  return limit === null ? null : Math.floor(limit * mult);
}

export function evaluateGuardrails(input: GuardrailInput): GuardrailResult {
  const { pull, hunks, policy, config: cfg } = input;
  const requireHuman: string[] = [];
  const blockers: string[] = [];
  const notes: string[] = [];
  const ruleFindings: RuleFindingInput[] = [];
  const { policy: scope, applied } = applyRules(basePolicy(cfg, input.severity ?? DEFAULT_SEVERITY), input.rules ?? [], pull);
  for (const name of scope.requireHuman) requireHuman.push(`Rule “${name}”: always a human`);
  for (const name of scope.noAutoApprove) blockers.push(`rule “${name}”: never auto-approved`);

  // Paths → category hits (requireHuman) and tier.
  const pol = evaluatePolicy(pull.files, policy);
  for (const hit of pol.hits) {
    const cat = hit.rule === "lockfile-without-manifest" ? null : categoryForGlob(hit.rule);
    const label = hit.rule === "lockfile-without-manifest" ? "Lockfile without manifest" : (cat?.label ?? `Path rule ${hit.rule}`);
    requireHuman.push(`${label}: ${hit.path}`);
  }
  let tier: Tier = "trivial";
  for (const f of pull.files) {
    const t = tierOfPath(f, policy, cfg);
    if (tierRank(t) > tierRank(tier)) tier = t;
  }
  if (pull.files.length === 0) tier = "standard";

  // Size, excluding generated/vendored/lockfile paths we can measure.
  const excluded = pull.files.filter((f) => matchesAny(f, cfg.sizeExcludeGlobs));
  let linesExcluded = 0;
  let unmeasured = 0;
  for (const f of excluded) {
    const fh = hunks.filter((h) => h.path === f);
    if (fh.length === 0 || fh.some((h) => h.noPatch)) unmeasured += 1;
    else linesExcluded += fh.reduce((s, h) => s + countChangedLines(h.patch), 0);
  }
  const lines = Math.max(0, pull.additions + pull.deletions - linesExcluded);
  const files = pull.files.length - excluded.length;
  if (unmeasured > 0) notes.push(`${unmeasured} excluded file(s) had no patch, so their lines still count toward size.`);

  const aiAuthored = isAiAuthored(pull, cfg);
  const mult = aiAuthored ? cfg.authors.aiSizeMultiplier : 1;
  const maxLines = scaled(scope.maxLines, mult);
  const maxFiles = scaled(scope.maxFiles, mult);
  const aiNote = aiAuthored && mult < 1 ? `, AI-authored ×${mult}` : "";
  if (maxLines !== null && lines > maxLines) {
    blockers.push(
      `${lines} lines > ${maxLines}-line limit${aiNote}${linesExcluded > 0 ? ` (excl. ${linesExcluded} generated/lockfile lines)` : ""}`,
    );
  }
  if (maxFiles !== null && files > maxFiles) blockers.push(`${files} files > ${maxFiles}-file limit${aiNote}`);

  // Tier envelope.
  if (tier !== "critical" && tierRank(tier) > tierRank(cfg.approveMaxTier as ApprovableTier)) {
    blockers.push(`${tier}-tier paths are above the approvable tier (${cfg.approveMaxTier})`);
  }

  // Dependencies.
  const deps = dependencyChanges(hunks);
  const cats = cfg.requireHumanCategories;
  for (const d of deps) {
    const what = `${d.name} ${d.from ?? ""}${d.from && d.to ? " → " : ""}${d.to ?? ""}`.trim();
    if (d.kind === "removed") continue;
    if (d.kind === "new") {
      if (cats.newDependencies) requireHuman.push(`New dependency: ${what} (${d.section})`);
      continue;
    }
    if (d.kind === "major" && cats.majorDependencyBumps) {
      requireHuman.push(`Major dependency bump: ${what}`);
      continue;
    }
    const kind = `${d.kind}:${d.section}`;
    if (!(cfg.dependencies.autoApprove as readonly string[]).includes(kind)) {
      blockers.push(`dependency ${d.kind} update (${d.section}) not auto-approvable: ${what}`);
    }
  }
  if (deps.length > 0 && cfg.dependencies.minReleaseAgeDays !== null) {
    notes.push(`Minimum release age (${cfg.dependencies.minReleaseAgeDays}d) is not enforced yet: it needs registry metadata.`);
  }

  // Tests for behaviour changes.
  if (scope.requireTests) {
    const isTest = (f: string) => matchesAny(f, policy.allowlist.test) !== null || /(\.test\.|\.spec\.|__tests__\/|^tests?\/)/.test(f);
    const isDocs = (f: string) => matchesAny(f, policy.allowlist.docs) !== null;
    const prod = pull.files.filter((f) => !isTest(f) && !isDocs(f) && !matchesAny(f, cfg.sizeExcludeGlobs));
    if (prod.length > 0 && !pull.files.some(isTest)) {
      ruleFindings.push({
        kind: "tests-missing",
        detail: `production code changed (${prod.length} file${prod.length === 1 ? "" : "s"}) with no test change`,
      });
    }
  }

  // Authors.
  const trustedBot = cfg.authors.trustedBots.some((p) => simpleGlob(p, pull.author));
  const firstTimeContributor = !input.authorHasMergedBefore && !trustedBot;
  if (firstTimeContributor && cats.firstTimeContributors) {
    requireHuman.push(`First-time contributor: ${pull.author}`);
  }

  // Freeze windows.
  const t = Date.parse(input.now);
  for (const w of cfg.freezeWindows) {
    if (t >= Date.parse(w.start) && t < Date.parse(w.end)) {
      blockers.push(`freeze window${w.note ? ` "${w.note}"` : ""} until ${w.end.slice(0, 10)}`);
    }
  }

  return {
    pullNumber: pull.number,
    tier,
    lines,
    linesExcluded,
    files,
    aiAuthored,
    firstTimeContributor,
    dependencyChanges: deps,
    requireHuman: [...new Set(requireHuman)],
    approveBlockers: [...new Set(blockers)],
    notes,
    ruleFindings,
    scope,
    appliedRules: applied,
  };
}

/** Evaluates every open pull of a repo (history is read once for first-time checks). */
export async function evaluateRepoGuardrails(
  store: PullStore,
  repoId: string,
  policy: PolicyRules,
  config: GuardrailsConfig,
  now: string,
  opts: {
    readonly states?: readonly PullRecord["state"][];
    readonly rules?: readonly ReviewRule[];
    readonly severity?: SeverityConfig;
  } = {},
): Promise<Map<number, GuardrailResult>> {
  const pulls = await store.listPulls(repoId);
  const states = new Set(opts.states ?? ["open"]);
  const mergedAt = new Map<string, string[]>();
  for (const p of pulls) {
    if (!p.mergedAt) continue;
    const list = mergedAt.get(p.author);
    if (list) list.push(p.mergedAt);
    else mergedAt.set(p.author, [p.mergedAt]);
  }
  const out = new Map<number, GuardrailResult>();
  for (const pull of pulls) {
    if (!states.has(pull.state)) continue;
    const hunks = await store.listHunks(repoId, pull.number);
    const authorHasMergedBefore = (mergedAt.get(pull.author) ?? []).some((m) => m < pull.createdAt);
    out.set(
      pull.number,
      evaluateGuardrails({
        pull,
        hunks,
        policy,
        config,
        authorHasMergedBefore,
        now: pull.state === "open" ? now : pull.createdAt,
        rules: opts.rules,
        severity: opts.severity,
      }),
    );
  }
  return out;
}
