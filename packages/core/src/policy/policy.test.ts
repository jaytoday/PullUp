import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, evaluatePolicy, globToRegExp } from "./policy.js";

describe("globToRegExp", () => {
  it("handles ** across directories and * within a segment", () => {
    expect(globToRegExp(".github/workflows/**").test(".github/workflows/ci.yml")).toBe(true);
    expect(globToRegExp("**/auth/**").test("src/auth/session.ts")).toBe(true);
    expect(globToRegExp("**/auth/**").test("auth/x.ts")).toBe(true);
    expect(globToRegExp("**/*.md").test("README.md")).toBe(true);
    expect(globToRegExp("docs/*.md").test("docs/a/b.md")).toBe(false);
    expect(globToRegExp("**/.env*").test("apps/web/.env.local")).toBe(true);
  });
});

describe("evaluatePolicy", () => {
  it("requires a human for CI, infra, migrations, auth paths", () => {
    for (const f of [".github/workflows/ci.yml", "infra/main.tf", "db/migrations/001.sql", "src/auth/jwt.ts"]) {
      expect(evaluatePolicy([f]).requiresHuman).toBe(true);
    }
    expect(evaluatePolicy(["src/api/users.ts"]).requiresHuman).toBe(false);
  });

  it("flags a lockfile changed without its manifest", () => {
    const r = evaluatePolicy(["pnpm-lock.yaml"]);
    expect(r.hits).toEqual([{ rule: "lockfile-without-manifest", path: "pnpm-lock.yaml" }]);
    expect(evaluatePolicy(["package.json", "pnpm-lock.yaml"]).requiresHuman).toBe(false);
  });

  it("allowlists a category only when every path matches it", () => {
    expect(evaluatePolicy(["docs/a.md", "README.md"]).category).toBe("docs");
    expect(evaluatePolicy(["src/a.test.ts"]).category).toBe("test");
    expect(evaluatePolicy(["docs/a.md", "src/a.ts"]).category).toBeNull();
    expect(evaluatePolicy([]).category).toBeNull();
  });

  it("is configurable", () => {
    const rules = { ...DEFAULT_POLICY, requireHumanGlobs: ["billing/**"] };
    expect(evaluatePolicy(["billing/charge.ts"], rules).requiresHuman).toBe(true);
    expect(evaluatePolicy([".github/workflows/ci.yml"], rules).requiresHuman).toBe(false);
  });
});
