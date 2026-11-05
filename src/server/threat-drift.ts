import { codeMapProblems, parseThreatModel } from "@pullup/extensions";
import type { GitHubApi } from "@pullup/github";
import { committedConfig } from "./extensions";
import { repoList } from "./dashboard";
import { getSetting, setSetting } from "./stores";

/**
 * The threat model's daily check on each repository's default branch: does the
 * file still parse, and does its code map still point at files and functions
 * that exist? Found once a day and shown in Settings, rather than reported on
 * every pull request. (The operator contract half, reading branch protection,
 * needs the GitHub App's Administration read permission and is not built.)
 */

export const DRIFT_EVERY_MS = 24 * 60 * 60_000;

export interface ThreatDrift {
  checkedAt: string;
  path: string;
  problems: string[];
}

const key = (repo: string) => `threat-drift:${repo}`;

export async function threatDrift(repo: string): Promise<ThreatDrift | null> {
  return getSetting<ThreatDrift | null>(key(repo), null);
}

/** Check one repository now. Null when its committed config does not use the threat-model extension. */
export async function checkThreatDrift(github: GitHubApi, repo: string, now: Date): Promise<ThreatDrift | null> {
  const file = await committedConfig(repo);
  const section = file?.extensions["threat-model"];
  if (!section || section.mode === "off") return null;
  const path = String(section.path ?? "THREATS.md");
  let problems: string[];
  try {
    const [model] = await github.readFiles(repo, { defaultBranch: true }, [path]);
    if (!model) problems = [`${path} is not on the default branch.`];
    else {
      const parsed = parseThreatModel(model.text);
      const mapped = [...new Set(parsed.inScope.flatMap((t) => t.code.map((c) => c.path)))];
      const tree = new Map((mapped.length ? await github.readFiles(repo, { defaultBranch: true }, mapped) : []).map((f) => [f.path, f.text]));
      problems = [...parsed.problems, ...codeMapProblems(parsed, (p) => tree.get(p) ?? null)];
    }
  } catch (err) {
    problems = [`Could not read the default branch: ${(err as Error).message}`];
  }
  const result: ThreatDrift = { checkedAt: now.toISOString(), path, problems };
  await setSetting(key(repo), result);
  return result;
}

/** The worker's daily pass over every repository. */
export async function checkThreatDriftDaily(github: GitHubApi, now: Date): Promise<number> {
  const last = await getSetting<string | null>("threat-drift-last", null);
  if (last && now.getTime() - new Date(last).getTime() < DRIFT_EVERY_MS) return 0;
  await setSetting("threat-drift-last", now.toISOString());
  let checked = 0;
  for (const r of await repoList()) if (await checkThreatDrift(github, r.fullName, now)) checked++;
  return checked;
}

