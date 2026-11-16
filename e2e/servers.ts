import { type ChildProcess, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { type LocalAskWithAI, startLocalAskWithAI } from "./local-askwithai";

/** PullUp in demo mode against a throwaway AskWithAI, for one test file. */
export interface Servers {
  askwithai: LocalAskWithAI;
  pullup: ChildProcess;
  url: string;
  runtime: string;
  stop: () => void;
}

export async function startServers(): Promise<Servers> {
  const askwithai = await startLocalAskWithAI();
  const port = Number(process.env.PULLUP_E2E_PORT ?? 3591);
  const url = `http://localhost:${port}`;
  const dbFile = ".data/e2e.db";
  rmSync(dbFile, { force: true });
  const runtime = `${askwithai.owner}/ci-review`;
  const pullup = spawn("pnpm", ["exec", "next", "dev", "-p", String(port)], {
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next-e2e",
      PULLUP_DB_FILE: dbFile,
      PULLUP_DEMO: "1",
      PULLUP_PERMIT_KEY: "e2e-permit-key",
      PULLUP_DECIDER: "askwithai",
      PULLUP_DECIDE_WAIT_MS: "1500",
      ASKWITHAI_URL: askwithai.url,
      ASKWITHAI_API_KEY: askwithai.apiKey,
      PULLUP_RUNTIME: runtime,
      ANTHROPIC_API_KEY: "",
      BETTER_AUTH_URL: url,
      BETTER_AUTH_SECRET: "pullup-e2e-secret-0123456789abcdef0123456789abcdef",
    },
    stdio: "ignore",
    detached: true,
  });
  const until = Date.now() + 240_000;
  for (;;) {
    const up = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.ok).catch(() => false);
    if (up) break;
    if (Date.now() > until) throw new Error("PullUp did not start");
    await new Promise((r) => setTimeout(r, 1000));
  }
  // The runtime, from AskWithAI's ci-review template (PullUp's package and its synthetic cases).
  await fetch(`${askwithai.url}/v1/templates/ci-review/use`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${askwithai.apiKey}` }, body: JSON.stringify({ slug: "ci-review" }) });
  return {
    askwithai,
    pullup,
    url,
    runtime,
    stop: () => {
      if (pullup.pid) process.kill(-pullup.pid);
      askwithai.stop();
    },
  };
}
