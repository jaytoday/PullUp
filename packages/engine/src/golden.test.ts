import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFixtures } from "./fixtures";
import { decideRun, type RunDecision } from "./resolution";
import { type Recording, replayCouncil } from "./withai-council";

/**
 * The three triggers moved into the `core` extension without changing any
 * decision. `fixtures/golden/` holds every fixture's decision from before the
 * move (written on commit f7d6f3f with `decideRun` and `replayCouncil`), with recorded
 * council answers where there are any. Question ids are compared after mapping
 * the old `flaky-test` to `core:flaky-test`; the fields the move added
 * (extension, key, shadow, the extensions record) are left out.
 */

const root = fileURLToPath(new URL("../../../fixtures", import.meta.url));

function asBefore(decision: RunDecision) {
  const { extensions: _, ...rest } = decision;
  return {
    ...rest,
    questions: rest.questions.map(({ question: { extension: _e, key, shadow: _s, id: _id, ...q }, ...r }) => ({ ...r, question: { id: key, trigger: key, ...q } })),
  };
}

describe("golden: the core extension decides exactly as the triggers did", () => {
  // Only the fixtures that existed before the move have a golden file.
  for (const f of loadFixtures(root).filter((x) => existsSync(`${root}/golden/${x.name}.json`))) {
    it(f.name, async () => {
      const recorded = `${root}/recorded/${f.name}.json`;
      const recording: Recording = existsSync(recorded) ? JSON.parse(readFileSync(recorded, "utf8")) : {};
      const golden = JSON.parse(readFileSync(`${root}/golden/${f.name}.json`, "utf8"));
      const decision = await decideRun(f.run, f.config, replayCouncil(recording), { now: 0 });
      expect(asBefore(decision)).toEqual(golden);
      expect(decision.questions.every((q) => q.question.extension === "core" && !q.question.shadow)).toBe(true);
    });
  }
});
