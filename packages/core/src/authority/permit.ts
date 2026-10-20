// Permits (Agent Baseline AUT-02): authority bound to one task. A permit is
// an HMAC-signed, single-use, short-lived record naming exactly what may be
// sent — repository, pull request, head commit, action, level, config hash and
// agent version. The actuator re-verifies it immediately before any GitHub
// call, so a permit issued before a stop, a quarantine, a config save or a new
// push is worthless.
//
// The key comes from PULLUP_PERMIT_KEY (operator env). Live delivery without
// a key denies every send (AUT-06, fail closed).

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthorityLevel } from "../actions/authority.js";
import type { BotReviewAction } from "../actions/review.js";
import { canonicalJson } from "../config/schema.js";
import type { GitHubReviewCall } from "../actions/review.js";
import { sha256 } from "../signals/hunks.js";
import type { GitHubPermissions } from "./profiles.js";

export const PERMIT_TTL_MS = 5 * 60 * 1000;

export interface PermitClaims {
  readonly v: 1;
  readonly taskId: string;
  readonly repoId: string;
  readonly pullNumber: number;
  readonly headSha: string;
  readonly action: BotReviewAction;
  readonly level: AuthorityLevel;
  readonly configHash: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly permissions: GitHubPermissions;
  /** sha256 of the exact GitHub call — the permit covers this call and no other. */
  readonly callHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
}

export interface Permit {
  readonly claims: PermitClaims;
  /** hex HMAC-SHA256 of the canonical claims. */
  readonly signature: string;
}

/** The operator's permit key, or null when unset (live sends are then denied). */
export function resolvePermitKey(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const key = env.PULLUP_PERMIT_KEY?.trim();
  return key ? key : null;
}

function sign(claims: PermitClaims, key: string): string {
  return createHmac("sha256", key).update(canonicalJson(claims)).digest("hex");
}

export function issuePermit(
  claims: Omit<PermitClaims, "v" | "issuedAt" | "expiresAt" | "nonce">,
  key: string,
  opts: { readonly now: string; readonly ttlMs?: number; readonly nonce?: string },
): Permit {
  const full: PermitClaims = {
    v: 1,
    ...claims,
    issuedAt: opts.now,
    expiresAt: new Date(Date.parse(opts.now) + (opts.ttlMs ?? PERMIT_TTL_MS)).toISOString(),
    nonce: opts.nonce ?? randomBytes(12).toString("hex"),
  };
  return { claims: full, signature: sign(full, key) };
}

/** Signature and expiry only; binding and single use are checked by the caller. */
export function verifyPermit(permit: Permit | undefined, key: string | null, now: string): string | null {
  if (!permit) return "no permit was issued for this action";
  if (!key) return "PULLUP_PERMIT_KEY is not set";
  const expected = Buffer.from(sign(permit.claims, key), "hex");
  const given = Buffer.from(String(permit.signature), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "permit signature is invalid";
  if (Date.parse(now) >= Date.parse(permit.claims.expiresAt)) return `permit expired at ${permit.claims.expiresAt}`;
  return null;
}

/** Hash of one planned GitHub call, bound into its permit. */
export function callHash(call: GitHubReviewCall): string {
  return sha256(canonicalJson(call));
}
