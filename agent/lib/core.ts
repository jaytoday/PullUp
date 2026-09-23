// Wiring between the thin eve tools and the deterministic @pullup/core engine:
// a lazily-initialized SQLite store (via @pullup/db) + config resolution.
// No domain logic here — that lives in the core package.

import { loadConfig } from "@pullup/core";
import type { CostPriors } from "@pullup/core";
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

/** Resolved priors: pullup.config.json in cwd, or defaults. */
export function getPriors(configPath = "pullup.config.json"): CostPriors {
  return loadConfig(configPath).priors;
}
