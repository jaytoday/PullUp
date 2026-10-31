// Evidence: an append-only record of every task, from recommendation to
// outcome. Each row stores the hash of the row before it in the same scope,
// so editing or deleting a row is detectable by walking the chain. This is
// the audit trail an examiner or auditor reads.

import { canonicalJson, sha256 } from "./canonical.js";

export type EvidenceKind = "decision" | "authorization" | "permit-issued" | "sent" | "blocked" | "outcome";

export interface EvidenceRow {
  readonly scope: string;
  readonly seq: number;
  readonly taskId: string;
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
  list(scope: string): Promise<EvidenceRow[]>;
}

export class MemoryEvidenceStore implements EvidenceStore {
  private readonly rows = new Map<string, EvidenceRow[]>();
  async last(scope: string): Promise<EvidenceRow | null> {
    return this.rows.get(scope)?.at(-1) ?? null;
  }
  async append(row: EvidenceRow): Promise<void> {
    const list = this.rows.get(row.scope) ?? [];
    if (list.some((r) => r.seq === row.seq)) throw new Error(`evidence row ${row.scope}#${row.seq} already exists`);
    this.rows.set(row.scope, [...list, row]);
  }
  async list(scope: string): Promise<EvidenceRow[]> {
    return [...(this.rows.get(scope) ?? [])];
  }
}

export function evidenceHash(row: Omit<EvidenceRow, "hash">): string {
  return sha256(canonicalJson(row));
}

/** Appends one row to its scope's chain. Retries once if another writer took the sequence number. */
export async function appendEvidence(store: EvidenceStore, entry: NewEvidence): Promise<EvidenceRow> {
  for (let attempt = 0; ; attempt++) {
    const prev = await store.last(entry.scope);
    const body = { ...entry, seq: (prev?.seq ?? 0) + 1, prevHash: prev?.hash ?? null };
    const row: EvidenceRow = { ...body, hash: evidenceHash(body) };
    try {
      await store.append(row);
      return row;
    } catch (err) {
      if (attempt > 0) throw err;
    }
  }
}

export interface ChainBreak {
  readonly scope: string;
  readonly seq: number;
  readonly problem: string;
}

/** Walks each scope's chain in order; reports every row whose hash or link does not hold. */
export function verifyChain(rows: readonly EvidenceRow[]): { ok: boolean; checked: number; breaks: ChainBreak[] } {
  const byScope = new Map<string, EvidenceRow[]>();
  for (const r of rows) byScope.set(r.scope, [...(byScope.get(r.scope) ?? []), r]);
  const breaks: ChainBreak[] = [];
  for (const [scope, list] of byScope) {
    list.sort((a, b) => a.seq - b.seq);
    let prev: EvidenceRow | null = null;
    let expected = 1;
    for (const r of list) {
      if (r.seq !== expected) breaks.push({ scope, seq: r.seq, problem: `expected row ${expected} (a row is missing)` });
      if (r.prevHash !== (prev?.hash ?? null)) breaks.push({ scope, seq: r.seq, problem: "link to the previous row does not match" });
      const { hash, ...rest } = r;
      if (evidenceHash(rest) !== hash) breaks.push({ scope, seq: r.seq, problem: "row content does not match its hash (edited)" });
      prev = r;
      expected = r.seq + 1;
    }
  }
  return { ok: breaks.length === 0, checked: rows.length, breaks };
}
