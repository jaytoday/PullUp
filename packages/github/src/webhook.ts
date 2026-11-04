import { createHmac, timingSafeEqual } from "node:crypto";

/** GitHub signs each delivery with the App's webhook secret (`X-Hub-Signature-256: sha256=<hex>`). */
export function verifyWebhookSignature(secret: string, body: string, header: string | null): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"), "hex");
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
