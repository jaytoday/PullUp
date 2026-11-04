/** Re-settle one run and post its check run again (after fixing a refused check run). `pnpm tsx scripts/finish-run.ts <runId>` */
import { migrateDb } from "@/lib/db/client";
import { finishRun, liveDeps } from "@/server/pipeline";

await migrateDb();
console.log(await finishRun(process.argv[2]!, liveDeps()));
process.exit(0);
