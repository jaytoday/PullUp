import type { EvidenceRow, EvidenceStore, NonceLedger } from "@pullup/engine";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { evidence, permitNonces, settings } from "@/lib/db/schema";

/** The evidence chain in the database; the (scope, seq) primary key refuses a second row with the same number. */
export const evidenceStore: EvidenceStore = {
  async last(scope) {
    const [row] = await db.select().from(evidence).where(eq(evidence.scope, scope)).orderBy(desc(evidence.seq)).limit(1);
    return (row as EvidenceRow | undefined) ?? null;
  },
  async append(row) {
    await db.insert(evidence).values(row);
  },
};

export async function evidenceFor(runId: string): Promise<EvidenceRow[]> {
  return (await db.select().from(evidence).where(eq(evidence.runId, runId)).orderBy(evidence.seq)) as EvidenceRow[];
}

export async function evidenceChain(scope: string): Promise<EvidenceRow[]> {
  return (await db.select().from(evidence).where(eq(evidence.scope, scope)).orderBy(evidence.seq)) as EvidenceRow[];
}

export const nonceLedger: NonceLedger = {
  async consume(nonce, expiresAt) {
    const inserted = await db.insert(permitNonces).values({ nonce, expiresAt }).onConflictDoNothing().returning();
    return inserted.length === 1;
  },
};

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** The stop switch: on through the settings row, or `PULLUP_STOP=1`. */
export async function isStopped(): Promise<boolean> {
  return process.env.PULLUP_STOP === "1" || (await getSetting("stopped", false));
}
