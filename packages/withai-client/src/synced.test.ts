import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WITHAI_CLIENT_VERSION } from "./index";

/**
 * In an app, this package is a copy of WithAI's client, refreshed by
 * `scripts/sync-withai-client.mjs`, which writes `SYNCED.json`. This test
 * fails when the copy was edited by hand, so changes go into WithAI first.
 * In WithAI itself there is no `SYNCED.json` and only the version is checked.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = join(root, "SYNCED.json");

describe("client copy", () => {
  it("states the same version as its package", () => {
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version).toBe(WITHAI_CLIENT_VERSION);
  });

  it.skipIf(!existsSync(stamp))("matches what was synced from WithAI", () => {
    const { files } = JSON.parse(readFileSync(stamp, "utf8")) as { files: Record<string, string> };
    for (const [file, hash] of Object.entries(files)) {
      const actual = createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
      expect(actual, `${file} differs from WithAI's client; change it there and run the sync script`).toBe(hash);
    }
  });
});
