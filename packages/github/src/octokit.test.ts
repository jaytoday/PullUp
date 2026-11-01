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

  it("sums additions/deletions from files when pulls.list omits them", async () => {
    const source = new OctokitPullSource({
      repoId: "o/r",
      octokit: fakeOctokit([
        { filename: "src/a.ts", patch: "@@ -1,1 +1,2 @@\n a\n+b", additions: 3, deletions: 1 } as never,
        { filename: "src/b.ts", additions: 4, deletions: 0 } as never,
      ]),
    });
    const [pull] = await source.listPulls();
    expect([pull!.additions, pull!.deletions, pull!.changedFiles]).toEqual([7, 1, 2]);
  });

  it("with pullNumbers, fetches only those PRs via pulls.get", async () => {
    const get = async ({ pull_number }: { pull_number: number }) => ({
      data: {
        number: pull_number,
        title: "t",
        user: { login: "u" },
        created_at: "2026-09-01T00:00:00Z",
        closed_at: null,
        merged_at: null,
        state: "open",
        base: { ref: "main" },
        head: { sha: "abc" },
        additions: 10,
        deletions: 2,
        changed_files: 1,
        labels: [],
      },
    });
    const octokit = {
      rest: { pulls: { get, list: () => { throw new Error("must not list"); }, listFiles: () => undefined } },
      paginate: async () => [{ filename: "src/a.ts", additions: 99 }],
    } as unknown as Octokit;
    const pulls = await new OctokitPullSource({ repoId: "o/r", octokit, pullNumbers: [42] }).listPulls();
    expect(pulls.map((p) => [p.number, p.additions])).toEqual([[42, 10]]);
  });
});

describe("OctokitPullSource lint rules", () => {
  /** A repo whose default branch has `.agents/gallant/` with a rule, a nested rule, a hidden folder and a non-rule file. */
  function contentsOctokit(tree: Record<string, Array<{ type: string; name: string }> | string>, calls: string[]): Octokit {
    return {
      rest: {
        repos: {
          getBranch: async ({ branch }: { branch: string }) => ({ data: { commit: { sha: `sha-of-${branch}` } } }),
          getContent: async ({ path, ref }: { path: string; ref: string }) => {
            calls.push(`${path}@${ref}`);
            const entry = tree[path];
            if (entry === undefined) throw Object.assign(new Error("Not Found"), { status: 404 });
            if (typeof entry === "string") return { data: { content: Buffer.from(entry).toString("base64"), encoding: "base64" } };
            return { data: entry.map((e) => ({ ...e, path: `${path}/${e.name}` })) };
          },
        },
      },
    } as unknown as Octokit;
  }

  it("reads rule files at the default branch's pinned commit, skipping hidden and non-Markdown files", async () => {
    const calls: string[] = [];
    const octokit = contentsOctokit(
      {
        ".agents/gallant": [
          { type: "file", name: "a.md" },
          { type: "file", name: "notes.txt" },
          { type: "dir", name: "go" },
          { type: "dir", name: ".hidden" },
        ],
        ".agents/gallant/a.md": "rule a",
        ".agents/gallant/go": [{ type: "file", name: "b.markdown" }],
        ".agents/gallant/go/b.markdown": "rule b",
        ".agents/gallant/.hidden": [{ type: "file", name: "c.md" }],
      },
      calls,
    );
    const source = new OctokitPullSource({ repoId: "o/r", octokit });
    const read = await source.readLintRules(".agents/gallant", "main");
    expect(read).toEqual({
      commitSha: "sha-of-main",
      files: [
        { path: "a.md", content: "rule a" },
        { path: "go/b.markdown", content: "rule b" },
      ],
    });
    expect(calls.every((c) => c.endsWith("@sha-of-main"))).toBe(true);
    expect(calls.some((c) => c.includes(".hidden"))).toBe(false);
  });

  it("returns null when the folder is missing, and throws on other errors so stored rules are kept", async () => {
    const source = new OctokitPullSource({ repoId: "o/r", octokit: contentsOctokit({}, []) });
    expect(await source.readLintRules(".agents/gallant", "main")).toBeNull();
    const broken = {
      rest: { repos: { getBranch: async () => ({ data: { commit: { sha: "s" } } }), getContent: async () => Promise.reject(Object.assign(new Error("boom"), { status: 500 })) } },
    } as unknown as Octokit;
    await expect(new OctokitPullSource({ repoId: "o/r", octokit: broken }).readLintRules(".agents/gallant", "main")).rejects.toThrow("boom");
  });
});
