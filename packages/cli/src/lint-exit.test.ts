import { describe, expect, it } from "vitest";
import { lintExitCode } from "./lint-exit.js";

describe("lintExitCode", () => {
  it("passes only when every file part was checked and no rule failed", () => {
    expect(lintExitCode({ failures: [], failed: 0 }, true)).toBe(0);
  });
  it("exits 1 when a rule fails, even if some parts also could not be checked", () => {
    expect(lintExitCode({ failures: [{}], failed: 0 }, true)).toBe(1);
    expect(lintExitCode({ failures: [{}], failed: 3 }, true)).toBe(1);
  });
  it("exits 2 when the model could not check some part (never a silent pass)", () => {
    expect(lintExitCode({ failures: [], failed: 2 }, true)).toBe(2);
  });
  it("always exits 0 with --no-fail", () => {
    expect(lintExitCode({ failures: [{}], failed: 2 }, false)).toBe(0);
  });
});
