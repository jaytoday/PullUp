/** Next.js server start hook: bring the database up to date, then start the worker loop unless a separate worker runs it. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { migrateDb } = await import("@/lib/db/client");
  await migrateDb();
  if (process.env.PULLUP_SEPARATE_WORKER !== "1") {
    const { startWorkerLoop } = await import("@/server/worker-loop");
    startWorkerLoop();
  }
}
