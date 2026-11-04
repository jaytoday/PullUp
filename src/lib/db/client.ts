import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

/**
 * PullUp's database. Production points at Turso (hosted SQLite) through
 * `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; without them it uses a local
 * file under `.data/` (`PULLUP_DB_FILE` picks another one, for tests).
 */
function connection() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (url && authToken) return { url, authToken };
  const dir = resolve(process.cwd(), ".data");
  mkdirSync(dir, { recursive: true });
  return { url: `file:${process.env.PULLUP_DB_FILE?.trim() || join(dir, "pullup.db")}` };
}

export const db = drizzle({ connection: connection(), schema });
export { schema };

let migrated: Promise<void> | undefined;

/** Apply `drizzle/` migrations once per process. */
export function migrateDb(): Promise<void> {
  migrated ??= migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return migrated;
}
