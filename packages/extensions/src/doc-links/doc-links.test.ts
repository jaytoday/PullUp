import { describe, expect, it } from "vitest";
import { testContext } from "../test-context";
import docLinks from ".";

const config = docLinks.config.schema.parse({});
const SHA = "abc1234def";
const diff = [
  "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1 +1 @@\n-a\n+b\n",
  "--- /dev/null\n+++ b/specs/session-length.md\n@@ -0,0 +1 @@\n+# Session length\n",
  "--- /dev/null\n+++ b/specs/[x](javascript:alert(1)).md\n@@ -0,0 +1 @@\n+# Injected\n",
].join("");
const files = [
  { path: "docs/designs/sessions.md", text: "Sessions live in src/auth/session.ts.", from: "head" as const },
  { path: "docs/designs/other.md", text: "Nothing related.", from: "head" as const },
];

describe("doc-links", () => {
  it("links design docs that mention a changed file and changed walkthrough specs, pinned to the head commit, with safe names only", () => {
    expect(docLinks.notes!(testContext(config, { headSha: SHA, repo: "acme/shop", diff, files }))).toEqual([
      { text: "Design doc docs/designs/sessions.md describes src/auth/session.ts", link: `https://github.com/acme/shop/blob/${SHA}/docs/designs/sessions.md` },
      { text: "Walkthrough: specs/session-length.md", link: `https://github.com/acme/shop/blob/${SHA}/specs/session-length.md` },
    ]);
  });

  it("never names a changed path with Markdown characters in it", () => {
    const odd = "--- a/src/[x](https:/evil.example).ts\n+++ b/src/[x](https:/evil.example).ts\n@@ -1 +1 @@\n-a\n+b\n";
    const doc = [{ path: "docs/designs/a.md", text: "See src/[x](https:/evil.example).ts", from: "head" as const }];
    expect(docLinks.notes!(testContext(config, { headSha: SHA, diff: odd, files: doc }))).toEqual([]);
  });

  it("links nothing when the head commit is not a real commit id", () => {
    expect(docLinks.notes!(testContext(config, { headSha: "localsha", diff, files }))).toEqual([]);
  });

  it("never raises a question", () => {
    expect(docLinks.detect).toBeUndefined();
  });
});
