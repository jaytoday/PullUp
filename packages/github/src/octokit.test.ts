import { describe, expect, it } from "vitest";
import type { Octokit } from "@octokit/rest";
import { OctokitPullSource } from "./octokit.js";

/** Just enough of octokit for listPulls: paginate dispatches on the endpoint fn. */
function fakeOctokit(files: Array<{ filename: string; patch?: string }>): Octokit {
  const list = () => undefined;
  const listFiles = () => undefined;
  return {
    rest: { pulls: { list, listFiles } },
    paginate: async (fn: unknown) =>
      fn === list
        ? [
            {
              number: 5,
              title: "t",
              user: { login: "u" },
              created_at: "2026-09-01T00:00:00Z",
              closed_at: null,
              merged_at: null,
              state: "open",
              base: { ref: "main" },
              head: { sha: "abc" },
              labels: [],
            },
          ]
        : files,
  } as unknown as Octokit;
}

describe("OctokitPullSource hunks", () => {
  it("keeps listFiles patches as parsed hunks; missing patch → noPatch marker", async () => {
    const source = new OctokitPullSource({
      repoId: "o/r",
      octokit: fakeOctokit([
        { filename: "src/a.ts", patch: "@@ -1,1 +1,2 @@\n a\n+b\n@@ -9,1 +10,1 @@\n-c\n+d" },
        { filename: "logo.png" },
      ]),
    });
    const [pull] = await source.listPulls();
    expect(pull!.files).toEqual(["src/a.ts", "logo.png"]);
    expect(pull!.hunks).toEqual([
      { path: "src/a.ts", index: 0, header: "@@ -1,1 +1,2 @@", patch: " a\n+b" },
      { path: "src/a.ts", index: 1, header: "@@ -9,1 +10,1 @@", patch: "-c\n+d" },
      { path: "logo.png", index: 0, header: "", patch: "", noPatch: true },
    ]);
  });
});
