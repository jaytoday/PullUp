import { describe, expect, it } from "vitest";
import type { HunkRecord } from "../schema/domain.js";
import { hunkContentHash, parseFilePatch } from "./hunks.js";
import { QUESTION_SET_V1 } from "./questions/v1.js";
import { buildUnits, cacheKeyFor, estimateTokens } from "./units.js";

function rec(path: string, patch: string, extra: Partial<HunkRecord> = {}): HunkRecord {
  const h = { path, header: "@@ -1,3 +1,4 @@", patch, noPatch: false, ...extra };
  return { repoId: "o/r", pullNumber: 7, index: 0, ...h, contentHash: hunkContentHash(h) };
}

describe("parseFilePatch", () => {
  it("splits a multi-hunk patch on @@ headers", () => {
    const patch = "@@ -1,2 +1,3 @@ fn a\n a\n+b\n@@ -10,2 +11,2 @@\n-c\n+d";
    const hunks = parseFilePatch("src/x.ts", patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ index: 0, header: "@@ -1,2 +1,3 @@ fn a", patch: " a\n+b" });
    expect(hunks[1]).toMatchObject({ index: 1, header: "@@ -10,2 +11,2 @@", patch: "-c\n+d" });
  });

  it("marks files with no patch (binary / too large) as noPatch", () => {
    expect(parseFilePatch("img.png", undefined)).toEqual([
      { path: "img.png", index: 0, header: "", patch: "", noPatch: true },
    ]);
  });

  it("content hash changes with content, not with identity", () => {
    const a = { path: "p", header: "h", patch: "+x" };
    expect(hunkContentHash(a)).toBe(hunkContentHash({ ...a }));
    expect(hunkContentHash(a)).not.toBe(hunkContentHash({ ...a, patch: "+y" }));
  });
});

describe("buildUnits", () => {
  it("keeps state code-only: path, area, hunk", () => {
    const [u] = buildUnits([rec("src/api/a.ts", "+const a = 1;")], QUESTION_SET_V1, { area: "api" });
    expect(Object.keys(u!.state).sort()).toEqual(["area", "hunk", "path"]);
    expect(u!.state.hunk).toContain("@@ -1,3 +1,4 @@");
  });

  it("splits oversized hunks into parts under the token budget, each re-carrying the header", () => {
    const line = "+" + "x".repeat(79);
    const patch = Array.from({ length: 400 }, () => line).join("\n");
    const budget = 2_000;
    const units = buildUnits([rec("src/big.ts", patch)], QUESTION_SET_V1, { area: "app", tokenBudget: budget });
    expect(units.length).toBeGreaterThan(1);
    for (const u of units) {
      expect(u.oversize).toBe(false);
      expect(u.state.hunk.startsWith("@@ -1,3 +1,4 @@")).toBe(true);
      expect(estimateTokens(u.state.hunk)).toBeLessThan(budget);
    }
    expect(new Set(units.map((u) => u.key)).size).toBe(units.length);
  });

  it("marks a single line longer than the budget as oversize (not evaluable)", () => {
    const units = buildUnits([rec("src/min.js", "+" + "y".repeat(40_000))], QUESTION_SET_V1, {
      area: "app",
      tokenBudget: 2_000,
    });
    expect(units.some((u) => u.oversize)).toBe(true);
  });

  it("cache keys depend on model id and question-set version", () => {
    const [u] = buildUnits([rec("src/a.ts", "+a")], QUESTION_SET_V1, { area: "app" });
    const k = cacheKeyFor("jev-1.13.0", "q-v1", u!);
    expect(cacheKeyFor("jev-1.13.0", "q-v1", u!)).toBe(k);
    expect(cacheKeyFor("jev-1.14.0", "q-v1", u!)).not.toBe(k);
    expect(cacheKeyFor("jev-1.13.0", "q-v2", u!)).not.toBe(k);
  });
});
