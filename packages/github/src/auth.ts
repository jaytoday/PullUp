// An octokit authenticated for one repository: a GitHub App installation
// token (GITHUB_APP_ID + GITHUB_PRIVATE_KEY), or GITHUB_TOKEN as a fallback for
// local runs. Adapted from code/pullup packages/github/src/auth.ts (commit a399ffc).

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export type GitHubEnv = Readonly<Record<string, string | undefined>>;

/** Hosted platforms often store keys with escaped newlines. */
export const normalizePrivateKey = (key: string) => (key.includes("\\n") ? key.replace(/\\n/g, "\n") : key);

const cache = new Map<string, Promise<Octokit>>();

export function repoOctokit(repo: string, env: GitHubEnv = process.env): Promise<Octokit> {
  const baseUrl = env.GITHUB_API_URL || undefined;
  if (!(env.GITHUB_APP_ID && env.GITHUB_PRIVATE_KEY)) {
    if (env.GITHUB_TOKEN) return Promise.resolve(new Octokit({ auth: env.GITHUB_TOKEN, baseUrl }));
    return Promise.reject(new Error("No GitHub credentials: set GITHUB_APP_ID and GITHUB_PRIVATE_KEY (GitHub App) or GITHUB_TOKEN."));
  }
  const key = `${baseUrl ?? ""}|${env.GITHUB_APP_ID}|${repo}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const auth = { appId: env.GITHUB_APP_ID!, privateKey: normalizePrivateKey(env.GITHUB_PRIVATE_KEY!) };
      const [owner, name] = repo.split("/") as [string, string];
      const app = new Octokit({ authStrategy: createAppAuth, auth, baseUrl });
      let installationId: number;
      try {
        ({ data: { id: installationId } } = await app.rest.apps.getRepoInstallation({ owner, repo: name }));
      } catch (err) {
        throw new Error(`The GitHub App is not installed on ${repo} (${(err as Error).message}).`);
      }
      return new Octokit({ authStrategy: createAppAuth, auth: { ...auth, installationId }, baseUrl });
    })();
    // A failed lookup (the App installed a minute later) must not be remembered.
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}
