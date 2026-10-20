// Runs the evidence verifier on the findings that could change an action if
// confirmed, caches verdicts by content, and attaches cached verdicts to a
// report's findings. Selection rules:
//
//   - risk-signal findings from the built-in questions at P0 or P1 (custom
//     questions are raise-only and capped at P1: confirming them changes nothing);
//   - active ("Use in decisions"), or observed when verify.inObserve is set;
//   - never on a pull request where the injection tripwire fired (its text is
//     hostile by assumption, and a model reading it can be steered);
//   - at most verify.maxPerPull per pull request, most severe first;
//   - within the daily budget.

import type { VerifyConfig } from "../config/verify.js";
import type { PullDecision } from "../cost/decision.js";
import type { Finding } from "../findings/findings.js";
import { parseUnitKey } from "../findings/locations.js";
import type { HunkRecord } from "../schema/domain.js";
import type { PullStore } from "../schema/store.js";
import { sha256 } from "../signals/hunks.js";
import type { QuestionSet } from "../signals/types.js";
import { acceptVerdict } from "./accept.js";
import type { EvidenceVerifier, RawVerdict, VerdictRecord, VerifyRunRecord } from "./types.js";

/** The hunks behind a finding (from its unit keys), in a stable order. */
export function findingHunks(f: Pick<Finding, "units">, hunks: readonly HunkRecord[]): HunkRecord[] {
  const wanted = new Set<string>();
  for (const key of f.units ?? []) {
    const u = parseUnitKey(key);
    if (u) wanted.add(`${u.path}#${u.index}`);
  }
  return hunks
    .filter((h) => wanted.has(`${h.path}#${h.index}`))
    .sort((a, b) => (a.path === b.path ? a.index - b.index : a.path.localeCompare(b.path)));
}

export function hunksHashOf(hs: readonly HunkRecord[]): string {
  return sha256(...hs.map((h) => h.contentHash).sort());
}

export function verdictCacheKey(verifierId: string, findingId: string, hunksHash: string): string {
  return sha256("verdict-v1", verifierId, findingId, hunksHash);
}

const LEVEL_RANK = { p0: 0, p1: 1, p2: 2 } as const;

/** The findings worth verifying on one decision (empty for injection pull requests). */
export function verifyCandidates(d: Pick<PullDecision, "findings" | "state">, cfg: VerifyConfig): Finding[] {
  if (d.state !== "open") return [];
  const findings = d.findings ?? [];
  if (findings.some((f) => f.kind === "injection")) return [];
  return findings
    .filter((f) => f.source === "signal" && f.kind === "signal" && f.level !== "p2" && (f.active || cfg.inObserve))
    .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.id.localeCompare(b.id))
    .slice(0, cfg.maxPerPull);
}

/** Live spend so far on this UTC day (from recorded verify runs). */
export async function spentToday(store: PullStore, repoId: string, now: string): Promise<number> {
  const day = now.slice(0, 10);
  return (await store.listVerifyRuns(repoId)).filter((r) => r.runAt.slice(0, 10) === day).reduce((s, r) => s + r.costUsd, 0);
}

export interface RunVerificationOptions {
  readonly config: VerifyConfig;
  readonly qs: QuestionSet;
  readonly now?: string;
  readonly pullNumbers?: readonly number[];
  readonly concurrency?: number;
}

export async function runVerification(
  store: PullStore,
  repoId: string,
  decisions: readonly PullDecision[],
  verifier: EvidenceVerifier,
  opts: RunVerificationOptions,
): Promise<VerifyRunRecord> {
  const now = opts.now ?? new Date().toISOString();
  const pulls = new Map((await store.listPulls(repoId)).map((p) => [p.number, p]));
  const hunks = await store.listHunks(repoId);
  const skipped: Array<{ pullNumber: number; findingId: string; reason: string }> = [];
  const errors: string[] = [];
  let spent = await spentToday(store, repoId, now);
  let cost = 0;
  let verified = 0;
  let cached = 0;

  const jobs: Array<() => Promise<void>> = [];
  for (const d of decisions) {
    if (opts.pullNumbers && !opts.pullNumbers.includes(d.pullNumber)) continue;
    if ((d.findings ?? []).some((f) => f.kind === "injection")) {
      for (const f of (d.findings ?? []).filter((x) => x.source === "signal" && x.kind === "signal")) {
        skipped.push({ pullNumber: d.pullNumber, findingId: f.id, reason: "injection tripwire: not verified" });
      }
      continue;
    }
    const pull = pulls.get(d.pullNumber);
    if (!pull) continue;
    const pullHunks = hunks.filter((h) => h.pullNumber === d.pullNumber);
    for (const f of verifyCandidates(d, opts.config)) {
      const fh = findingHunks(f, pullHunks);
      if (fh.length === 0) {
        skipped.push({ pullNumber: d.pullNumber, findingId: f.id, reason: "no hunks to check" });
        continue;
      }
      const hunksHash = hunksHashOf(fh);
      const cacheKey = verdictCacheKey(verifier.id, f.id, hunksHash);
      jobs.push(async () => {
        if (await store.getVerdict(cacheKey)) {
          cached++;
          return;
        }
        if (spent + cost >= opts.config.budgetUsdPerDay) {
          skipped.push({ pullNumber: d.pullNumber, findingId: f.id, reason: `daily budget of $${opts.config.budgetUsdPerDay} reached` });
          return;
        }
        const qid = f.id.replace(/^signal:/, "");
        let raw: RawVerdict;
        try {
          raw = await verifier.verify({
            repoId,
            pullNumber: d.pullNumber,
            headSha: pull.headSha ?? "",
            finding: { id: f.id, level: f.level, title: f.title, detail: f.detail },
            question: opts.qs.questions[qid]?.text ?? f.title,
            hunks: fh,
          });
        } catch (err) {
          raw = { verdict: "unsure", evidence: [], fix: null, reason: "", costUsd: 0, error: err instanceof Error ? err.message : String(err) };
        }
        if (raw.error) errors.push(`#${d.pullNumber} ${f.id}: ${raw.error}`);
        cost += raw.costUsd;
        verified++;
        const rec: VerdictRecord = {
          cacheKey,
          repoId,
          pullNumber: d.pullNumber,
          findingId: f.id,
          hunksHash,
          verdict: acceptVerdict(raw, fh, verifier.id),
          costUsd: raw.costUsd,
          createdAt: now,
        };
        // Errors aren't cached: the next run tries again.
        if (!raw.error) await store.upsertVerdict(rec);
      });
    }
  }

  const limit = Math.max(1, opts.concurrency ?? 4);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) await jobs[next++]!();
    }),
  );
  spent += cost;
  const run: VerifyRunRecord = { repoId, runAt: now, verifierId: verifier.id, verified, cached, skipped, costUsd: cost, errors };
  await store.recordVerifyRun(run);
  return run;
}

/**
 * Attaches the newest cached verdict to each signal finding whose hunks are
 * unchanged. Only ever adds a `verdict` field: levels, findings and
 * recommendations are untouched.
 */
export async function attachVerdicts(store: PullStore, repoId: string, decisions: readonly PullDecision[]): Promise<PullDecision[]> {
  const records = await store.listVerdicts(repoId);
  if (records.length === 0) return [...decisions];
  const hunks = await store.listHunks(repoId);
  return decisions.map((d) => {
    if (!d.findings?.length) return d;
    const pullRecords = records.filter((r) => r.pullNumber === d.pullNumber);
    if (pullRecords.length === 0) return d;
    const pullHunks = hunks.filter((h) => h.pullNumber === d.pullNumber);
    const findings = d.findings.map((f) => {
      if (f.source !== "signal" || f.kind !== "signal") return f;
      const hash = hunksHashOf(findingHunks(f, pullHunks));
      const rec = pullRecords
        .filter((r) => r.findingId === f.id && r.hunksHash === hash)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return rec ? { ...f, verdict: rec.verdict } : f;
    });
    return { ...d, findings };
  });
}
