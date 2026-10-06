import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config/config.js";
import type { ConfigFile } from "../config/schema.js";
import type { HunkRecord } from "../schema/domain.js";
import { dependencyChanges, evaluateGuardrails } from "./guardrails.js";
import type { GuardrailInput } from "./guardrails.js";

const NOW = "2026-09-01T00:00:00.000Z";

function hunk(path: string, patch: string, noPatch = false): HunkRecord {
  return { repoId: "o/r", pullNumber: 1, path, index: 0, header: "@@", patch, noPatch, contentHash: "x" };
}

function run(
  files: string[],
  opts: { file?: ConfigFile; hunks?: HunkRecord[]; additions?: number; deletions?: number; author?: string; labels?: string[]; merged?: boolean; now?: string } = {},
) {
  const cfg = resolveConfig({ file: opts.file ?? {} });
  const input: GuardrailInput = {
    pull: {
      number: 1,
      author: opts.author ?? "alice",
      createdAt: "2026-08-31T00:00:00.000Z",
      additions: opts.additions ?? 10,
      deletions: opts.deletions ?? 2,
      files,
      labels: opts.labels ?? [],
    },
    hunks: opts.hunks ?? [],
    policy: cfg.policy,
    config: cfg.guardrails,
    authorHasMergedBefore: opts.merged ?? true,
    now: opts.now ?? NOW,
  };
  return evaluateGuardrails(input);
}

describe("size limits", () => {
  it("blocks approval over the line limit, excluding measured lockfile lines", () => {
    const lock = hunk("pnpm-lock.yaml", Array.from({ length: 300 }, (_, i) => `+line${i}`).join("\n"));
    const r = run(["src/a.ts", "pnpm-lock.yaml", "package.json"], {
      file: { guardrails: { maxAutoApproveLines: 200 } },
      hunks: [lock],
      additions: 450,
      deletions: 0,
    });
    expect(r.lines).toBe(150);
    expect(r.linesExcluded).toBe(300);
    expect(r.approveBlockers).toEqual([]);
    const big = run(["src/a.ts"], { file: { guardrails: { maxAutoApproveLines: 200 } }, additions: 250, deletions: 50 });
    expect(big.approveBlockers).toEqual(["300 lines > 200-line limit"]);
  });

  it("unmeasurable excluded files still count, with a note", () => {
    const r = run(["yarn.lock", "src/a.ts"], { hunks: [hunk("yarn.lock", "", true)], additions: 900 });
    expect(r.lines).toBe(902);
    expect(r.notes.join()).toMatch(/no patch/);
  });

  it("AI-authored PRs get the stricter multiplier", () => {
    const file: ConfigFile = { guardrails: { maxAutoApproveLines: 200, authors: { aiSizeMultiplier: 0.5, aiAuthors: ["copilot*"] } } };
    expect(run(["src/a.ts"], { file, additions: 150, author: "copilot-swe-agent" }).approveBlockers[0]).toMatch(/152 lines > 100-line limit, AI-authored ×0.5/);
    expect(run(["src/a.ts"], { file, additions: 150, labels: ["ai-generated"] }).aiAuthored).toBe(true);
    expect(run(["src/a.ts"], { file, additions: 150 }).approveBlockers).toEqual([]);
  });

  it("file limit", () => {
    expect(run(["a.ts", "b.ts", "c.ts"], { file: { guardrails: { maxAutoApproveFiles: 2 } } }).approveBlockers).toEqual([
      "3 files > 2-file limit",
    ]);
  });
});

describe("tiers and categories", () => {
  it("category paths require a human; the tier is the max over files", () => {
    const r = run(["docs/a.md", ".github/workflows/ci.yml"]);
    expect(r.tier).toBe("critical");
    expect(r.requireHuman).toEqual(["CI workflows: .github/workflows/ci.yml"]);
    expect(run(["docs/a.md"]).tier).toBe("trivial");
    expect(run(["src/a.ts"]).tier).toBe("standard");
  });

  it("disabling a non-locked category lifts the escalation", () => {
    expect(run(["src/auth/x.ts"]).requireHuman).toHaveLength(1);
    expect(run(["src/auth/x.ts"], { file: { guardrails: { requireHumanCategories: { auth: false } } } }).requireHuman).toEqual([]);
  });

  it("tiers above the approvable tier block approval", () => {
    const file: ConfigFile = { guardrails: { approveMaxTier: "low", tiers: { low: ["src/internal/**"], high: ["src/api/**"] } } };
    expect(run(["src/internal/x.ts"], { file }).approveBlockers).toEqual([]);
    expect(run(["src/other.ts"], { file }).approveBlockers[0]).toMatch(/standard-tier/);
    expect(run(["src/api/x.ts"], { file: { guardrails: { tiers: { high: ["src/api/**"] } } } }).approveBlockers[0]).toMatch(/high-tier/);
  });
});

describe("dependencies", () => {
  const manifest = (patch: string) => hunk("package.json", patch);

  it("parses new, bumped and moved dependencies with section context", () => {
    const deps = dependencyChanges([
      manifest(
        [
          '   "dependencies": {',
          '-    "zod": "^3.22.0",',
          '+    "zod": "^4.1.0",',
          '+    "left-pad": "^1.3.0",',
          "   },",
          '   "devDependencies": {',
          '-    "vitest": "^2.1.8",',
          '+    "vitest": "^2.1.9",',
          "   },",
          '   "scripts": {',
          '+    "lint": "eslint ."',
        ].join("\n"),
      ),
    ]);
    expect(deps).toEqual([
      expect.objectContaining({ name: "left-pad", kind: "new", section: "runtime" }),
      expect.objectContaining({ name: "vitest", kind: "patch", section: "dev" }),
      expect.objectContaining({ name: "zod", kind: "major", section: "runtime" }),
    ]);
  });

  it("new deps and major bumps require a human; disallowed kinds block approval", () => {
    const hunks = [manifest('   "dependencies": {\n-    "a": "1.2.0",\n+    "a": "1.3.0",\n+    "b": "^2.0.0",\n-    "c": "1.0.0",\n+    "c": "2.0.0"')];
    const r = run(["package.json"], { hunks, file: { guardrails: { dependencies: { autoApprove: ["patch:runtime"] } } } });
    expect(r.requireHuman).toEqual(["New dependency: b ^2.0.0 (runtime)", "Major dependency bump: c 1.0.0 → 2.0.0"]);
    expect(r.approveBlockers).toEqual(["dependency minor update (runtime) not auto-approvable: a 1.2.0 → 1.3.0"]);
  });

  it("minimum release age is noted, not enforced", () => {
    const hunks = [manifest('   "devDependencies": {\n-    "a": "1.2.0",\n+    "a": "1.2.1"')];
    const r = run(["package.json"], { hunks, file: { guardrails: { dependencies: { minReleaseAgeDays: 14 } } } });
    expect(r.approveBlockers).toEqual([]);
    expect(r.notes.join()).toMatch(/not enforced/);
  });
});

describe("tests, authors, freeze", () => {
  it("requires a test change for production code when configured", () => {
    const file: ConfigFile = { guardrails: { tests: { requireForBehaviorChange: true } } };
    // A rule-backed P1 finding (the severity policy decides what happens), not a size-style blocker.
    expect(run(["src/a.ts"], { file }).ruleFindings).toEqual([{ kind: "tests-missing", detail: expect.stringMatching(/no test change/) }]);
    expect(run(["src/a.ts"], { file }).approveBlockers).toEqual([]);
    expect(run(["src/a.ts", "src/a.test.ts"], { file }).ruleFindings).toEqual([]);
    expect(run(["docs/a.md"], { file }).ruleFindings).toEqual([]);
  });

  it("first-time contributors require a human; trusted bots are exempt", () => {
    expect(run(["src/a.ts"], { merged: false, author: "newbie" }).requireHuman).toEqual(["First-time contributor: newbie"]);
    expect(run(["src/a.ts"], { merged: false, author: "renovate[bot]" }).requireHuman).toEqual([]);
  });

  it("freeze windows block approval while active", () => {
    const file: ConfigFile = { guardrails: { freezeWindows: [{ start: "2026-08-30T00:00:00Z", end: "2026-09-02T00:00:00Z", note: "launch" }] } };
    expect(run(["src/a.ts"], { file }).approveBlockers).toEqual(['freeze window "launch" until 2026-09-02']);
    expect(run(["src/a.ts"], { file, now: "2026-09-03T00:00:00Z" }).approveBlockers).toEqual([]);
  });
});
