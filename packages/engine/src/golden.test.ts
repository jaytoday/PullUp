import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectConcerns } from "./concerns";
import { loadFixtures } from "./fixtures";
import { findHardFailures } from "./hard-failure";

/**
 * Every fixture's expected concerns. These were the old pipeline's triggers
 * (flaky test, weakened tests, sensitive path); the detectors moved unchanged,
 * so each fixture raises the same things under the new names.
 */

const root = fileURLToPath(new URL("../../../fixtures", import.meta.url));

describe("golden: concerns detected on every fixture", () => {
  for (const f of loadFixtures(root)) {
    it(`${f.name}: ${f.description}`, () => {
      // A hard failure decides the run before any concern is looked at.
      const concerns = findHardFailures(f.run, f.config).length ? [] : detectConcerns(f.run, f.config).map((c) => c.concern);
      expect(concerns).toEqual(f.expect.concerns);
    });
  }
});
