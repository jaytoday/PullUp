// Permits: authority bound to one task. A permit is an HMAC-signed,
// single-use, short-lived record naming exactly what may be done — the case,
// the action, the amount, the configuration and agent version, and a hash of
// the exact call. The code that carries out the action re-verifies it right
// before acting, so a permit issued before a stop, a configuration change or
// a change to the case is worthless.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CaseAction, Effect } from "./authority.js";
import { canonicalJson, sha256 } from "./canonical.js";

export const PERMIT_TTL_MS = 5 * 60 * 1000;

export interface PermitClaims {
  readonly v: 1;
  readonly taskId: string;
  readonly scope: string;
  readonly caseId: string;
  readonly action: CaseAction;
  readonly effect: Effect;
  readonly amount: number;
  readonly configHash: string;
  readonly agentVersion: string;
  /** sha256 of the exact call — the permit covers this call and no other. */
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
  private readonly used = new Map<string, string>();
  consume(nonce: string, expiresAt: string): boolean {
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, expiresAt);
    return true;
  }
}

function sign(claims: PermitClaims, key: string): string {
  return createHmac("sha256", key).update(canonicalJson(claims)).digest("hex");
}

export function callHash(call: unknown): string {
  return sha256(canonicalJson(call));
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

/**
 * Full check right before acting: signature, expiry, that the permit covers
 * this exact call, and single use. Returns null when valid, else the reason.
 */
export async function checkPermit(
  permit: Permit | undefined,
  call: unknown,
  opts: { readonly key: string | null; readonly now: string; readonly ledger: NonceLedger },
): Promise<string | null> {
  if (!permit) return "no permit was issued for this action";
  if (!opts.key) return "no permit key is configured";
  const expected = Buffer.from(sign(permit.claims, opts.key), "hex");
  const given = Buffer.from(String(permit.signature), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "permit signature is invalid";
  if (Date.parse(opts.now) >= Date.parse(permit.claims.expiresAt)) return `permit expired at ${permit.claims.expiresAt}`;
  if (callHash(call) !== permit.claims.callHash) return "permit does not cover this call";
  if (!(await opts.ledger.consume(permit.claims.nonce, permit.claims.expiresAt))) return "permit was already used";
  return null;
}
