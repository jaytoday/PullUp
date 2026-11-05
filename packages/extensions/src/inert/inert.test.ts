import { describe, expect, it } from "vitest";
import { testContext } from "../test-context";
import inert, { claimedFlags, disqualifiers } from ".";

const config = inert.config.schema.parse({});
const pull = (body: string, labels: string[] = []) => ({ number: 1, title: "t", body, labels, author: "a" });
const reasons = (diff: string) => disqualifiers(testContext(config, { diff })).map((p) => p.reason);
const file = (path: string, lines: string) => `--- a/${path}\n+++ b/${path}\n@@ -1,20 +1,20 @@\n${lines}`;

describe("the inert claim", () => {
  it("reads flags from PullUp-Inert lines, or the label alone; nothing claimed is null", () => {
    expect(claimedFlags(pull("Faster.\nPullUp-Inert: flag=newCheckout\npullup-inert: oldBanner"), "pullup:inert")).toEqual(["newCheckout", "oldBanner"]);
    expect(claimedFlags(pull("", ["pullup:inert"]), "pullup:inert")).toEqual([]);
    expect(claimedFlags(pull("no claim"), "pullup:inert")).toBeNull();
    expect(claimedFlags(null, "pullup:inert")).toBeNull();
  });

  it("does nothing without a claim, except asking about a flag turned on", () => {
    const ctx = testContext(config, { diff: file("src/flags.ts", "-  a: false,\n+  a: true,\n"), pull: pull("") });
    expect(inert.screens!(ctx)).toEqual([]);
    expect(inert.detect!(ctx).questions!.map((q) => q.key)).toEqual(["flag-activation"]);
    expect(inert.notes!(ctx)).toEqual([]);
  });
});

describe("code disqualifiers", () => {
  it("risky kinds of file disprove the claim", () => {
    expect(reasons("--- a/db/migrations/2.sql\n+++ b/db/migrations/2.sql\n@@ -1 +1 @@\n-a\n+b\n")).toEqual(["db/migrations/2.sql is a database migration, which takes effect without any flag"]);
    expect(reasons(file("package.json", "-  \"x\": \"1\"\n+  \"x\": \"2\"\n"))[0]).toMatch(/dependency change/);
  });

  it("negated gates: new code under one disproves; a kill switch around existing code and an early return do not", () => {
    expect(reasons(file("src/a.ts", "+  if (!isEnabled(\"skipAudit\")) await audit(x);\n"))).toEqual(["src/a.ts adds code under a negated flag check, which runs while the flag is off"]);
    expect(reasons(file("src/a.ts", "-  await save(x);\n+  if (!isEnabled(\"disableSave\")) await save(x);\n"))).toEqual([]);
    expect(reasons(file("src/a.ts", "+  if (!isEnabled(\"newSearch\")) return res.status(404).end();\n+  res.json(search());\n"))).toEqual([]);
    expect(reasons(file("src/a.ts", "+  if (!isEnabled(\"skipAudit\")) {\n+    await audit(x);\n+  }\n"))).toEqual(["src/a.ts adds code under a negated flag check, which runs while the flag is off"]);
    expect(reasons(file("src/a.ts", "-  await save(x);\n+  if (!isEnabled(\"disableSave\")) {\n+    await save(x);\n+  }\n"))).toEqual([]);
  });

  it("new code in a file with no flag check disproves, unless a new file only declares things", () => {
    expect(reasons(file("src/pricing.ts", "-  return a;\n+  return b;\n"))).toEqual(["src/pricing.ts changes code with no flag check in the file"]);
    expect(reasons("--- /dev/null\n+++ b/src/helper.ts\n@@ -0,0 +1,3 @@\n+export function helper(a: number) {\n+  return a * 2;\n+}\n")).toEqual([]);
    expect(reasons("--- /dev/null\n+++ b/src/warm.ts\n@@ -0,0 +1,1 @@\n+setInterval(tick, 1000);\n")).toEqual(["src/warm.ts changes code with no flag check in the file"]);
    expect(reasons(file("src/a.test.ts", "-  a\n+  b\n"))).toEqual([]);
  });

  it("startup patterns from the config disprove", () => {
    const ctx = testContext({ ...config, startupPatterns: ["app\\.(get|post)\\("] }, { diff: file("src/server.ts", "+if (isEnabled(\"x\")) {}\n+app.get(\"/x\", h);\n") });
    expect(disqualifiers(ctx).map((p) => p.reason)).toEqual(["src/server.ts adds code that runs at startup (app\\.(get|post)\\()"]);
  });

  it("a bad regular expression in the config is refused", () => {
    expect(inert.config.schema.safeParse({ gatePatterns: ["(("] }).success).toBe(false);
  });
});
