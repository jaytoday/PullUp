import { liveDeps, processOpenRuns } from "./pipeline";

const EVERY_MS = 60_000;
let started = false;

/** Every minute, look again at runs still collecting. Started once per process. */
export function startWorkerLoop() {
  if (started) return;
  started = true;
  const tick = () =>
    processOpenRuns(liveDeps())
      .catch((err: Error) => console.error("pullup worker:", err.message))
      .finally(() => setTimeout(tick, EVERY_MS).unref());
  setTimeout(tick, 5_000).unref();
}
