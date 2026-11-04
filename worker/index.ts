/** The worker as its own process (set PULLUP_SEPARATE_WORKER=1 on the web server). */
import { migrateDb } from "@/lib/db/client";
import { startWorkerLoop } from "@/server/worker-loop";

await migrateDb();
startWorkerLoop();
setInterval(() => {}, 1 << 30);
