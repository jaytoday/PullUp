import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUNDLED } from "./registry";

/**
 * Extensions are pure: they may import only the SDK, zod and their own files,
 * so none can reach the network, the database, the clock or GitHub. The
 * repository has no linter, so this test is the check.
 */

const src = fileURLToPath(new URL(".", import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [join(dir, e.name)] : []));
const ALLOWED = /^(?:@pullup\/sdk|zod|\.{1,2}\/.*)$/;
const FORBIDDEN_GLOBALS = /\b(?:fetch|XMLHttpRequest|WebSocket|Date\.now|new Date\(|Math\.random|process\.|require\(|import\()/;

describe("extensions are pure", () => {
  for (const file of files(src)) {
    it(file.slice(src.length), () => {
      const text = readFileSync(file, "utf8");
      const imports = [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
      expect(imports.filter((i) => !ALLOWED.test(i))).toEqual([]);
      const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code.match(FORBIDDEN_GLOBALS)?.[0] ?? null).toBeNull();
    });
  }

  it("ids are unique, lowercase, and every field points at a setting with a default", () => {
    expect(new Set(BUNDLED.map((e) => e.id)).size).toBe(BUNDLED.length);
    for (const e of BUNDLED) {
      expect(e.id).toMatch(/^[a-z][a-z0-9-]*$/);
      const defaults = e.config.schema.parse({});
      for (const f of e.config.fields) {
        const value = f.key.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], defaults);
        expect(value, `${e.id}.${f.key}`).not.toBeUndefined();
      }
    }
  });
});
