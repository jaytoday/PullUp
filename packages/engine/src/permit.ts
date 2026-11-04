// Permits: every GitHub call PullUp makes needs one. A permit is an
// HMAC-signed, single-use, short-lived record naming the exact call (by hash);
// the sender re-checks it right before acting. Adapted from code/pullup
// packages/control/src/permit.ts (commit a399ffc), trimmed to what PullUp sends.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalJson, sha256 } from "./canonical";

export const PERMIT_TTL_MS = 5 * 60 * 1000;

export interface PermitClaims {
  readonly v: 1;
  /** The repository the call acts on (`owner/name`). */
  readonly repo: string;
  /** What kind of call, e.g. `check-run`. */
  readonly action: string;
  /** sha256 of the exact call: the permit covers this call and no other. */
  readonly callHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
}

export interface Permit {
  readonly claims: PermitClaims;
  readonly signature: string;
}

/** Remembers used permits. `consume` returns false when the nonce was already used. */
export interface NonceLedger {
  consume(nonce: string, expiresAt: string): boolean | Promise<boolean>;
}

export class MemoryNonceLedger implements NonceLedger {
  private readonly used = new Set<string>();
  consume(nonce: string): boolean {
    if (this.used.has(nonce)) return false;
    this.used.add(nonce);
    return true;
  }
}

const sign = (claims: PermitClaims, key: string) => createHmac("sha256", key).update(canonicalJson(claims)).digest("hex");

export const callHash = (call: unknown) => sha256(canonicalJson(call));

export function issuePermit(repo: string, action: string, call: unknown, key: string, now: Date): Permit {
  const claims: PermitClaims = {
    v: 1,
    repo,
    action,
    callHash: callHash(call),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PERMIT_TTL_MS).toISOString(),
    nonce: randomBytes(12).toString("hex"),
  };
  return { claims, signature: sign(claims, key) };
}

/** Full check right before acting. Returns null when valid, else the reason. */
export async function checkPermit(permit: Permit | undefined, call: unknown, opts: { key: string | null; now: Date; ledger: NonceLedger }): Promise<string | null> {
  if (!permit) return "no permit was issued for this call";
  if (!opts.key) return "no permit key is configured";
  const expected = Buffer.from(sign(permit.claims, opts.key), "hex");
  const given = Buffer.from(String(permit.signature), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "permit signature is invalid";
  if (opts.now.getTime() >= Date.parse(permit.claims.expiresAt)) return `permit expired at ${permit.claims.expiresAt}`;
  if (callHash(call) !== permit.claims.callHash) return "permit does not cover this call";
  if (!(await opts.ledger.consume(permit.claims.nonce, permit.claims.expiresAt))) return "permit was already used";
  return null;
}
