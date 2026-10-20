// Picks the evidence verifier for a run: the live Claude verifier when asked
// for (or when ANTHROPIC_API_KEY is set and nothing was asked), otherwise the
// deterministic synthetic stand-in.

import type { EvidenceVerifier, VerifyConfig } from "@pullup/core";
import { SyntheticEvidenceVerifier } from "@pullup/core/testing";
import { createRepoOctokit } from "@pullup/github";
import type { GitHubEnv } from "@pullup/github";
import { ClaudeEvidenceVerifier } from "./claude.js";
import { githubRepoReader } from "./repo.js";

export type VerifierKind = "claude" | "synthetic";

export function resolveEvidenceVerifier(opts: {
  readonly kind?: VerifierKind;
  readonly config: VerifyConfig;
  readonly env?: GitHubEnv & { readonly ANTHROPIC_API_KEY?: string };
}): { verifier: EvidenceVerifier; note: string | null } {
  const env = opts.env ?? process.env;
  const kind = opts.kind ?? (env.ANTHROPIC_API_KEY ? "claude" : "synthetic");
  if (kind === "synthetic") {
    return { verifier: new SyntheticEvidenceVerifier(), note: "synthetic evidence verifier (deterministic stand-in, no model calls)" };
  }
  return {
    verifier: new ClaudeEvidenceVerifier({
      model: opts.config.model,
      reader: async (req) => githubRepoReader(await createRepoOctokit(req.repoId, env), req.repoId, req.headSha),
    }),
    note: null,
  };
}
