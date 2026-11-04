import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ciRunSchema } from "./ci";
import { parseConfig } from "./config";
import { loadFixtures } from "./fixtures";
import { findHardFailures } from "./hard-failure";

const FIXTURES = fileURLToPath(new URL("../../../fixtures", import.meta.url));
const fixtures = loadFixtures(FIXTURES);

describe("hard failures over every fixture", () => {
  it("has fixtures for both outcomes", () => {
    expect(fixtures.filter((f) => f.expect.hardFailure).length).toBeGreaterThan(2);
    expect(fixtures.filter((f) => !f.expect.hardFailure).length).toBeGreaterThan(2);
  });

  for (const f of fixtures) {
    it(`${f.name}: ${f.description}`, () => {
      const failures = findHardFailures(f.run, f.config);
      expect(failures.length > 0).toBe(f.expect.hardFailure);
      for (const failure of failures) expect(failure.reason.length).toBeGreaterThan(0);
    });
  }
});

describe("hard failure details", () => {
  const config = parseConfig({ requiredWorkflows: ["ci"] });
  const run = (attempts: object[]) => ciRunSchema.parse({ repo: "a/b", headSha: "x", jobs: [{ workflow: "ci", name: "test", attempts }] });

  it("names the failing tests and carries the log excerpt as evidence", () => {
    const [failure] = findHardFailures(run([{ conclusion: "failure", failedTests: ["a > b"], logExcerpt: "expected 1" }]), config);
    expect(failure).toMatchObject({ workflow: "ci", job: "test", reason: "test failed: a > b.", logExcerpt: "expected 1" });
  });

  it("a rerun that fails every time is hard; one that passes once is not", () => {
    const fail = { conclusion: "failure", failedTests: ["a"] };
    expect(findHardFailures(run([fail, fail, fail]), config)[0]?.reason).toMatch(/all 3 attempts/);
    expect(findHardFailures(run([fail, { conclusion: "success" }]), config)).toEqual([]);
  });

  it("a cancelled required job is not a pass", () => {
    expect(findHardFailures(run([{ conclusion: "cancelled" }]), config)[0]?.reason).toMatch(/ended cancelled/);
  });

  it("a required workflow whose jobs were all skipped is not a pass", () => {
    expect(findHardFailures(run([{ conclusion: "skipped" }]), config)[0]?.reason).toMatch(/was skipped/);
  });

  it("refuses a config with no required workflow", () => {
    expect(() => parseConfig({ requiredWorkflows: [] })).toThrow();
  });
});
