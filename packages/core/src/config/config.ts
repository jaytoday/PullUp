// Config loading and layering (node side). Precedence, lowest first:
//
//   defaults < pullup.config.json (file) < repo config version (DB, per repo)
//
// Presets are never applied implicitly: picking one in the UI writes its values
// into the repo layer. The effective config is hashed (canonical JSON) so
// reports and logged actions can say exactly which config produced them.

import { readFileSync } from "node:fs";
import { sha256 } from "../signals/hunks.js";
import type { ConfigVersionRecord, PullStore } from "../schema/store.js";
import type { ConfigFile, ResolvedConfig } from "./schema.js";
import { canonicalJson, configFileSchema, configSources, defaultConfigFile, mergeConfig, resolveConfigFile } from "./schema.js";

export * from "./schema.js";

export interface ResolveConfigInput {
  readonly file?: ConfigFile;
  readonly path?: string | null;
  readonly repo?: ConfigFile | null;
  readonly version?: number | null;
}

/** Resolves layered config. Both layers must already be schema-valid. */
export function resolveConfig(input: ResolveConfigInput = {}): ResolvedConfig {
  const file = input.file ?? {};
  const repo = input.repo ?? null;
  const merged = mergeConfig<ConfigFile>(file, repo);
  const effective = mergeConfig<ConfigFile>(defaultConfigFile(), merged);
  return {
    ...resolveConfigFile(merged),
    path: input.path ?? null,
    fileOverrides: Object.keys(file),
    file,
    repo,
    version: repo ? (input.version ?? null) : null,
    hash: sha256(canonicalJson(effective)),
    sources: configSources(file, repo),
  };
}

/** Reads and validates the file layer. Absent file → `{}`. */
export function loadConfigFile(path = "pullup.config.json"): { file: ConfigFile; path: string | null } {
  try {
    const raw = readFileSync(path, "utf8");
    return { file: configFileSchema.parse(JSON.parse(raw)), path };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { file: {}, path: null };
    throw new Error(`Invalid pullup config at ${path}: ${(err as Error).message}`);
  }
}

/** Loads priors from an optional `pullup.config.json`. Absent file → defaults. */
export function loadConfig(path?: string): ResolvedConfig {
  const { file, path: resolvedPath } = loadConfigFile(path ?? "pullup.config.json");
  return resolveConfig({ file, path: resolvedPath });
}

/** Re-resolves a file-level config with a repo's saved version layered on top. */
export function withRepoLayer(base: ResolvedConfig, latest: ConfigVersionRecord | null): ResolvedConfig {
  return resolveConfig({ file: base.file, path: base.path, repo: latest?.config ?? null, version: latest?.version ?? null });
}

/** File config + the repo's latest saved version (if any). */
export async function loadRepoConfig(store: PullStore, repoId: string, path?: string): Promise<ResolvedConfig> {
  const latest = (await store.listConfigVersions(repoId)).at(-1) ?? null;
  return withRepoLayer(loadConfig(path), latest);
}

/** The buildReport options a resolved config implies: guardrails + provenance. */
export function configReportOptions(cfg: ResolvedConfig) {
  return {
    guardrails: { config: cfg.guardrails, policy: cfg.policy, rules: cfg.rules, severity: cfg.severity },
    configProvenance: { version: cfg.version, hash: cfg.hash },
  } as const;
}
