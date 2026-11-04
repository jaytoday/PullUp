/** Check a repository's evidence chain: `pnpm tsx scripts/verify-chain.ts <owner/repo>` */
import { verifyChain } from "@pullup/engine";
import { migrateDb } from "@/lib/db/client";
import { evidenceChain } from "@/server/stores";

await migrateDb();
const rows = await evidenceChain(process.argv[2]!);
const kinds = rows.reduce<Record<string, number>>((n, r) => ({ ...n, [r.kind]: (n[r.kind] ?? 0) + 1 }), {});
console.log(rows.length, "entries", JSON.stringify(kinds), verifyChain(rows));
process.exit(0);
