/**
 * Check that a webhook call came from WithAI.
 *
 * WithAI signs each webhook body with your token's webhook secret and sends
 * `WithAI-Signature: t=<unix seconds>,v1=<hex>`, where `<hex>` is
 * HMAC-SHA256 of `<t>.<raw body>`. Pass the raw body exactly as received
 * (before parsing JSON). Uses Web Crypto, so it runs in Node 20+, Deno,
 * Bun, edge runtimes and browsers.
 */

export const SIGNATURE_HEADER = "WithAI-Signature";

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Compare without leaking how many leading characters matched. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signWebhookBody(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}

/**
 * True when `signatureHeader` is a valid signature of `body` made with
 * `secret` within the last `toleranceSeconds` (default five minutes), which
 * refuses replays of old calls.
 */
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  signatureHeader: string | null | undefined,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => part.trim().split("=", 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  return sameText(await hmacHex(secret, `${timestamp}.${body}`), parts.v1);
}
