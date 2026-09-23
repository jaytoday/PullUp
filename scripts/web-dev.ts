// Dev: PullUp API (tsx watch, :4174) + Vite (:5174, proxies /api). Ctrl-C stops both.
// Children get no stdin: `tsx watch` exits on stdin EOF in non-TTY shells.
import { spawn } from "node:child_process";

const procs = {
  api: spawn("pnpm", ["exec", "tsx", "watch", "packages/server/src/main.ts"], { stdio: ["ignore", "inherit", "inherit"] }),
  web: spawn("pnpm", ["--filter", "@pullup/web", "dev"], { stdio: ["ignore", "inherit", "inherit"] }),
};
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const p of Object.values(procs)) p.kill("SIGTERM");
  process.exitCode = code;
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const [name, p] of Object.entries(procs)) {
  p.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[web-dev] ${name} exited (${signal ?? code}) — stopping the other process.`);
    stop(code ?? 1);
  });
}
