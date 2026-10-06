// Authenticated octokit for one repo. Same credentials as the eve GitHub
// channel, so one GitHub App serves webhooks, reads and review writes:
//
//   GITHUB_APP_ID + GITHUB_PRIVATE_KEY  → installation token for the repo
//                                         (GITHUB_INSTALLATION_ID skips the lookup)
//   GITHUB_TOKEN                        → a PAT / Actions token (fallback)
//
// The installation token is minted and refreshed by @octokit/auth-app.

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { parseRepoId } from "@pullup/core";

export type GitHubEnv = Readonly<Record<string, string | undefined>>;

export type GitHubAuthMode = "app" | "token";

export function githubAuthMode(env: GitHubEnv = process.env): GitHubAuthMode | null {
  if (env.GITHUB_APP_ID && env.GITHUB_PRIVATE_KEY) return "app";
  if (env.GITHUB_TOKEN) return "token";
  return null;
}

/** Hosted platforms often store PEMs with escaped newlines. */
export function normalizePrivateKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

const cache = new Map<string, Promise<Octokit>>();

/**
 * An octokit authenticated for `repoId`. Throws a readable error when no
 * credentials are configured or the App is not installed on the repo.
 */
export function createRepoOctokit(repoId: string, env: GitHubEnv = process.env): Promise<Octokit> {
  const mode = githubAuthMode(env);
  if (!mode) {
    return Promise.reject(
      new Error("No GitHub credentials: set GITHUB_APP_ID + GITHUB_PRIVATE_KEY (GitHub App) or GITHUB_TOKEN."),
    );
  }
  const baseUrl = env.GITHUB_API_URL || undefined;
  if (mode === "token") return Promise.resolve(new Octokit({ auth: env.GITHUB_TOKEN, baseUrl }));

  const key = `${baseUrl ?? ""}|${env.GITHUB_APP_ID}|${repoId}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const appId = env.GITHUB_APP_ID!;
      const privateKey = normalizePrivateKey(env.GITHUB_PRIVATE_KEY!);
      let installationId = env.GITHUB_INSTALLATION_ID ? Number(env.GITHUB_INSTALLATION_ID) : undefined;
      if (!installationId) {
        const { owner, repo } = parseRepoId(repoId);
        const app = new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey }, baseUrl });
        try {
          ({ data: { id: installationId } } = await app.rest.apps.getRepoInstallation({ owner, repo }));
        } catch (err) {
          throw new Error(`GitHub App ${appId} is not installed on ${repoId} (${(err as Error).message}).`);
        }
      }
      return new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey, installationId }, baseUrl });
    })();
    // A failed lookup (e.g. App installed a minute later) must not be pinned.
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}
