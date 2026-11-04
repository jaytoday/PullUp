// Evidence: an append-only record of every run, from collection to what was
// sent to GitHub. Each row stores the hash of the row before it in the same
// scope (one scope per repository), so editing or deleting a row shows when
// the chain is walked. Copied from code/pullup packages/control/src/evidence.ts
// (commit a399ffc), with PullUp's own kinds.

import { canonicalJson, sha256 } from "./canonical";

export type EvidenceKind = "collected" | "decided" | "permit-issued" | "sent" | "blocked" | "asked" | "answered";

export interface EvidenceRow {
  readonly scope: string;
  readonly seq: number;
  readonly runId: string;
  readonly kind: EvidenceKind;
  readonly at: string;
  readonly payload: unknown;
  readonly prevHash: string | null;
  readonly hash: string;
}

export type NewEvidence = Omit<EvidenceRow, "seq" | "prevHash" | "hash">;

/** Storage for evidence. `append` must reject a row whose seq is already taken. */
export interface EvidenceStore {
  last(scope: string): Promise<EvidenceRow | null>;
  append(row: EvidenceRow): Promise<void>;
}

export class MemoryEvidenceStore implements EvidenceStore {
  readonly rows: EvidenceRow[] = [];
  async last(scope: string) {
    return this.rows.filter((r) => r.scope === scope).at(-1) ?? null;
  }
  async append(row: EvidenceRow) {
    if (this.rows.some((r) => r.scope === row.scope && r.seq === row.seq)) throw new Error(`evidence row ${row.scope}#${row.seq} already exists`);
    this.rows.push(row);
  }
}

export const evidenceHash = (row: Omit<EvidenceRow, "hash">) => sha256(canonicalJson(row));

/** Appends one row to its scope's chain. Retries a few times if another writer took the sequence number. */
export async function appendEvidence(store: EvidenceStore, entry: NewEvidence): Promise<EvidenceRow> {
  for (let attempt = 0; ; attempt++) {
    const prev = await store.last(entry.scope);
    const body = { ...entry, seq: (prev?.seq ?? 0) + 1, prevHash: prev?.hash ?? null };
    const row: EvidenceRow = { ...body, hash: evidenceHash(body) };
    try {
      await store.append(row);
      return row;
    } catch (err) {
      if (attempt >= 3) throw err;
    }
  }
}

/** Walks each scope's chain in order; reports every row whose hash or link does not hold. */
export function verifyChain(rows: readonly EvidenceRow[]): { ok: boolean; breaks: { scope: string; seq: number; problem: string }[] } {
  const byScope = new Map<string, EvidenceRow[]>();
  for (const r of rows) byScope.set(r.scope, [...(byScope.get(r.scope) ?? []), r]);
  const breaks: { scope: string; seq: number; problem: string }[] = [];
  for (const [scope, list] of byScope) {
    list.sort((a, b) => a.seq - b.seq);
    let prev: EvidenceRow | null = null;
    for (const r of list) {
      if (r.seq !== (prev?.seq ?? 0) + 1) breaks.push({ scope, seq: r.seq, problem: "a row is missing before this one" });
      if (r.prevHash !== (prev?.hash ?? null)) breaks.push({ scope, seq: r.seq, problem: "link to the previous row does not match" });
      const { hash, ...rest } = r;
      if (evidenceHash(rest) !== hash) breaks.push({ scope, seq: r.seq, problem: "row content does not match its hash (edited)" });
      prev = r;
    }
  }
  return { ok: breaks.length === 0, breaks };
}
