import { appDeps } from "./demo";
import { processOpenRuns } from "./pipeline";

const EVERY_MS = 60_000;
let started = false;

/** Every minute: runs still collecting, waiting runs, and outcomes that are due. Started once per process. */
export function startWorkerLoop() {
  if (started) return;
  started = true;
  const tick = () =>
    processOpenRuns(appDeps())
      .catch((err: Error) => console.error("pullup worker:", err.message))
      .finally(() => setTimeout(tick, EVERY_MS).unref());
  setTimeout(tick, 5_000).unref();
}
