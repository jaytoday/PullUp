// Per-action GitHub credentials (Agent Baseline AUT-04).
//
// With a GitHub App, every live action gets its own installation token,
// minted for exactly one repository and the minimum permissions the action
// needs (POST /app/installations/{id}/access_tokens with `repositories` and
// `permissions`), and revoked right after the action (DELETE
// /installation/token). GitHub tokens live up to an hour and cannot be
// shortened, so revocation is what makes the window short. The token stays
// inside this module: it is never returned by a tool or written to a record.
//
// A personal token (GITHUB_TOKEN) cannot be narrowed: it is a
// "standing-token" credential, and the authorizer only lets it comment.

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { CredentialKind, GitHubPermissions } from "@pullup/core";
import { parseRepoId } from "@pullup/core";
import type { ReviewClient } from "./actuator.js";
import { octokitReviewClient } from "./actuator.js";
import type { GitHubEnv } from "./auth.js";
import { githubAuthMode, normalizePrivateKey } from "./auth.js";

/** A credential for one action. `revoke` is idempotent and never throws. */
export interface ScopedCredential {
  readonly kind: CredentialKind;
  readonly client: ReviewClient;
  readonly repositories: readonly string[];
  readonly permissions: Readonly<Record<string, string>>;
  revoke(): Promise<{ revoked: boolean; error?: string }>;
}

export interface CredentialBroker {
  readonly kind: CredentialKind;
  mint(repoId: string, permissions: GitHubPermissions): Promise<ScopedCredential>;
}

/** The credential kind this environment can provide (null = none configured). */
export function credentialKind(env: GitHubEnv = process.env): CredentialKind | null {
  const mode = githubAuthMode(env);
  return mode === "app" ? "app" : mode === "token" ? "standing-token" : null;
}

/** GitHub App broker: one downscoped, revocable installation token per action. */
export function appCredentialBroker(env: GitHubEnv = process.env): CredentialBroker {
  const appId = env.GITHUB_APP_ID!;
  const privateKey = normalizePrivateKey(env.GITHUB_PRIVATE_KEY!);
  const baseUrl = env.GITHUB_API_URL || undefined;
  const installations = new Map<string, number>();

  async function installationFor(repoId: string): Promise<number> {
    if (env.GITHUB_INSTALLATION_ID) return Number(env.GITHUB_INSTALLATION_ID);
    const cached = installations.get(repoId);
    if (cached) return cached;
    const { owner, repo } = parseRepoId(repoId);
    const app = new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey }, baseUrl });
    try {
      const { data } = await app.rest.apps.getRepoInstallation({ owner, repo });
      installations.set(repoId, data.id);
      return data.id;
    } catch (err) {
      throw new Error(`GitHub App ${appId} is not installed on ${repoId} (${(err as Error).message}).`);
    }
  }

  return {
    kind: "app",
    async mint(repoId, permissions) {
      const installationId = await installationFor(repoId);
      const { repo } = parseRepoId(repoId);
      // The App-authenticated octokit carries baseUrl into the token request.
      const app = new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey, installationId }, baseUrl });
      // refresh: never reuse a cached token minted for a different action.
      const minted = (await app.auth({
        type: "installation",
        installationId,
        repositoryNames: [repo],
        permissions: { ...permissions },
        refresh: true,
      })) as { token: string; permissions: Record<string, string> };
      const octokit = new Octokit({ auth: minted.token, baseUrl });
      let revoked: { revoked: boolean; error?: string } | null = null;
      return {
        kind: "app",
        client: octokitReviewClient(octokit),
        repositories: [repoId],
        permissions: { ...minted.permissions },
        async revoke() {
          if (revoked) return revoked;
          try {
            await octokit.request("DELETE /installation/token");
            revoked = { revoked: true };
          } catch (err) {
            revoked = { revoked: false, error: (err as Error).message };
          }
          return revoked;
        },
      };
    },
  };
}

/** Personal-token broker: the same standing token every time; nothing to revoke. */
export function standingTokenBroker(env: GitHubEnv = process.env): CredentialBroker {
  const octokit = new Octokit({ auth: env.GITHUB_TOKEN, baseUrl: env.GITHUB_API_URL || undefined });
  return staticBroker(octokitReviewClient(octokit), "standing-token");
}

/** A broker over a fixed client (tests, and the standing-token case). */
export function staticBroker(
  client: ReviewClient,
  kind: CredentialKind,
  hooks: { readonly onMint?: (repoId: string, permissions: GitHubPermissions) => void; readonly onRevoke?: () => void } = {},
): CredentialBroker {
  return {
    kind,
    async mint(repoId, permissions) {
      hooks.onMint?.(repoId, permissions);
      return {
        kind,
        client,
        repositories: kind === "app" ? [repoId] : ["*"],
        permissions: kind === "app" ? (Object.fromEntries(Object.entries(permissions)) as Record<string, string>) : { all: "standing" },
        async revoke() {
          if (kind !== "app") return { revoked: false, error: "a standing token cannot be revoked per action" };
          hooks.onRevoke?.();
          return { revoked: true };
        },
      };
    },
  };
}

/** The broker for this environment, or null when no GitHub credentials are set. */
export function createCredentialBroker(env: GitHubEnv = process.env): CredentialBroker | null {
  const kind = credentialKind(env);
  if (kind === "app") return appCredentialBroker(env);
  if (kind === "standing-token") return standingTokenBroker(env);
  return null;
}
