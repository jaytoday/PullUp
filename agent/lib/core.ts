// Wiring between the thin eve tools and the deterministic @pullup/core engine:
// a lazily-initialized SQLite store (via @pullup/db) + config resolution.
// No domain logic here — that lives in the core package.

import { eveAgentIdentity, loadRepoConfig } from "@pullup/core";
import type { AgentIdentity, ResolvedConfig } from "@pullup/core";
import { createClient, SqliteStore } from "@pullup/db";

const DB_PATH = process.env.PULLUP_DB_PATH || "pullup.db";

let storePromise: Promise<SqliteStore> | undefined;

/** Lazily creates (and migrates) the SQLite store once per process. */
export async function getStore(): Promise<SqliteStore> {
  storePromise ??= (async () => {
    const client = createClient({ url: `file:${DB_PATH}` });
    const store = new SqliteStore(client);
    await store.migrate();
    return store;
  })();
  return storePromise;
}

/** Config for one repo: the file plus the repo's latest saved settings version. */
export async function getRepoConfig(repoId: string, configPath = "pullup.config.json"): Promise<ResolvedConfig> {
  return loadRepoConfig(await getStore(), repoId, configPath);
}

let identity: AgentIdentity | undefined;

/**
 * This agent's identity: a composition hash over agent.ts, instructions.ts,
 * every tool, the core version, the question set and the model. A new hash
 * may only comment until `pullup agents approve <hash>` (docs/authority.md).
 */
export function getAgentIdentity(): AgentIdentity {
  identity ??= eveAgentIdentity(process.env.PULLUP_ROOT ?? process.cwd());
  return identity;
}
