import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { codeMapProblems, parseThreatModel } from "@pullup/extensions";
import { describe, expect, it } from "vitest";

/** PullUp's own threat model (docs/threat-model.md) must parse, and its code map must point at code that exists. */
const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("PullUp's own threat model", () => {
  const model = parseThreatModel(readFileSync(`${root}docs/threat-model.md`, "utf8"));

  it("parses with no problems", () => {
    expect(model.problems).toEqual([]);
    expect(model.inScope.length).toBeGreaterThanOrEqual(10);
    expect(model.contract.map((c) => c.key)).toContain("branch-protection-requires: PullUp");
  });

  it("every mapped file exists and defines the mapped function", () => {
    expect(codeMapProblems(model, (path) => (existsSync(`${root}${path}`) ? readFileSync(`${root}${path}`, "utf8") : null))).toEqual([]);
  });
});
