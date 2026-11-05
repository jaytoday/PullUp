import { type Config, configInput, describeExtensions, loosenings, parseConfig, storedConfig } from "@pullup/engine";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { runs, settings } from "@/lib/db/schema";
import { getSetting, setSetting } from "./stores";

/**
 * Extension settings for one repository. PullUp never writes to a repository:
 * the config that counts is `.pullup/config.json` on its default branch. The
 * settings page edits a draft of that file, kept here until the owner commits
 * it; the next run reads whatever is committed.
 */

export type ConfigFile = ReturnType<typeof configInput>;

const draftKey = (repo: string) => `config-draft:${repo}`;

/** The config the latest run of `repo` used (what is committed), as a file. */
export async function committedConfig(repo: string): Promise<ConfigFile | null> {
  const [latest] = await db.select().from(runs).where(eq(runs.repo, repo)).orderBy(desc(runs.firstSeenAt)).limit(1);
  return latest?.config ? configInput(storedConfig(latest.config)) : null;
}

export async function extensionsEditor(repo: string) {
  const committed = await committedConfig(repo);
  const draft = await getSetting<ConfigFile | null>(draftKey(repo), null);
  // Only what the dashboard needs to draw the list and the forms (no JSON Schemas).
  const extensions = describeExtensions().map(({ configSchema: _, ...e }) => e);
  return { committed, draft, extensions };
}

/** Looser settings in `next` that the committed config does not already have. */
export function newLoosenings(next: Config, committed: Config | null): string[] {
  const before = new Set(committed ? loosenings(committed) : []);
  return loosenings(next).filter((l) => !before.has(l));
}

/**
 * Save a draft with new extension settings. Refused when it does not parse, or
 * when it loosens PullUp and "loosen" was not typed.
 */
export async function saveDraft(repo: string, extensions: Record<string, Record<string, unknown>>, confirmation: string): Promise<{ file: ConfigFile; loosenings: string[] }> {
  const committed = await committedConfig(repo);
  if (!committed) throw new Error("PullUp has not read this repository's config yet.");
  const base = (await getSetting<ConfigFile | null>(draftKey(repo), null)) ?? committed;
  const parsed = parseConfig({ ...base, extensions });
  const loose = newLoosenings(parsed, parseConfig(committed));
  if (loose.length && confirmation.trim().toLowerCase() !== "loosen") throw new Error(`These settings loosen PullUp; type "loosen" to keep them: ${loose.join(" ")}`);
  const file = configInput(parsed);
  await setSetting(draftKey(repo), file);
  return { file, loosenings: loose };
}

export async function discardDraft(repo: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, draftKey(repo)));
}
