// Deterministic JSON (sorted keys) and hashing: the basis of permit signatures
// and the evidence chain. Copied from jaytoday/PullUp@a399ffc:packages/control/src/canonical.ts.

import { createHash } from "node:crypto";

export function canonicalJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(",")}]`;
  if (x !== null && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype) {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

export function sha256(...parts: readonly string[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
}
