import { type ChildProcess, spawn } from "node:child_process";

/**
 * A throwaway AskWithAI for PullUp's browser test and demo check: started
 * from the checkout in ASKWITHAI_REPO with an in-memory database and demo
 * engines (no model keys, nothing kept), with one account and one API key.
 */

export interface LocalAskWithAI {
  url: string;
  apiKey: string;
  owner: string;
  stop: () => void;
}

async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(15_000) })).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`AskWithAI did not start at ${url}`);
}

export async function startLocalAskWithAI(port = Number(process.env.ASKWITHAI_E2E_PORT ?? 3792)): Promise<LocalAskWithAI> {
  const repo = process.env.ASKWITHAI_REPO;
  if (!repo) throw new Error("Set ASKWITHAI_REPO to an AskWithAI checkout.");
  const url = `http://localhost:${port}`;
  let child: ChildProcess | null = null;
  const already = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.ok).catch(() => false);
  if (!already) {
    child = spawn("pnpm", ["exec", "next", "dev", "-p", String(port)], {
      cwd: repo,
      env: {
        ...process.env,
        PGLITE_DATA_DIR: "",
        NEXT_DIST_DIR: ".next-pullup-e2e",
        BETTER_AUTH_URL: url,
        BETTER_AUTH_SECRET: "pullup-e2e-secret-0123456789abcdef0123456789abcdef",
        WITHAI_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    await waitFor(`${url}/api/health`, 240_000);
  }
  const email = `pullup-e2e-${Date.now()}@example.com`;
  const signup = await fetch(`${url}/api/auth/sign-up/email`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ name: "PullUp Demo", email, password: "password123" }) });
  if (!signup.ok) throw new Error(`AskWithAI sign-up failed: ${signup.status} ${await signup.text()}`);
  const cookie = (signup.headers.getSetCookie?.() ?? [signup.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).join("; ");
  const studio = (path: string, init: RequestInit = {}) => fetch(`${url}${path}`, { ...init, headers: { "content-type": "application/json", origin: url, cookie } });
  const ws = (await (await studio("/api/studio/workspace")).json()) as { handle: string };
  const key = (await (await studio("/api/studio/keys", { method: "POST", body: JSON.stringify({ name: "PullUp" }) })).json()) as { secret: string };
  if (!key.secret) throw new Error("Could not create an AskWithAI API key.");
  return {
    url,
    apiKey: key.secret,
    owner: ws.handle,
    stop: () => {
      if (child?.pid) process.kill(-child.pid);
    },
  };
}

// `npx tsx e2e/local-askwithai.ts <env file>`: start one and write its settings to the env file (the key is never printed).
if (process.argv[1]?.endsWith("local-askwithai.ts")) {
  const out = process.argv[2];
  if (!out) throw new Error("Name a file to write the settings to.");
  startLocalAskWithAI().then(async (a) => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, `ASKWITHAI_URL=${a.url}\nASKWITHAI_API_KEY=${a.apiKey}\nPULLUP_RUNTIME=${a.owner}/ci-review\n`, { mode: 0o600 });
    console.log(`AskWithAI is up at ${a.url} (account owner ${a.owner}); settings written to ${out}.`);
  });
}
