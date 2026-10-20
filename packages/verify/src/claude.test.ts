// The Claude verifier loop with a scripted fake client (never the network).

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { HunkRecord, VerifyRequest } from "@pullup/core";
import { ClaudeEvidenceVerifier, costUsd, renderHunks } from "./claude.js";
import type { RepoReader } from "./repo.js";
import { numbered, safeRepoPath } from "./repo.js";

const hunk: HunkRecord = {
  repoId: "acme/api",
  pullNumber: 7,
  path: "src/auth.ts",
  index: 0,
  header: "@@ -10,3 +10,3 @@",
  patch: [" function check(user) {", "-  requireRole(user, 'admin');", "+  return;", " }"].join("\n"),
  noPatch: false,
  contentHash: "h1",
};

const req: VerifyRequest = {
  repoId: "acme/api",
  pullNumber: 7,
  headSha: "abc123",
  finding: { id: "signal:touchesAuthz", level: "p0", title: "t", detail: "p=0.95" },
  question: "Does this code change who is allowed to do what?",
  hunks: [hunk],
};

const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

type Scripted = { stop_reason: string; content: unknown[]; stop_details?: unknown };

function fakeClient(script: Scripted[]) {
  const requests: Array<Record<string, unknown>> = [];
  const client = {
    beta: {
      messages: {
        async create(params: Record<string, unknown>) {
          requests.push(JSON.parse(JSON.stringify(params)));
          const next = script.shift();
          if (!next) throw new Error("script exhausted");
          return { model: "claude-opus-5", usage, ...next };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

const reader: RepoReader = {
  async readFile(path) {
    return `1: // ${path}\n2: export function requireRole() {}`;
  },
  async listDir() {
    return ["src/"];
  },
  async searchCode() {
    return ["src/roles.ts"];
  },
};

const submit = (input: unknown) => ({ type: "tool_use", id: "s1", name: "submit_verdict", input });

describe("ClaudeEvidenceVerifier", () => {
  it("runs read-only tools, then returns the submitted verdict with its cost", async () => {
    const { client, requests } = fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "src/roles.ts", start_line: null, end_line: null } }] },
      { stop_reason: "tool_use", content: [submit({ verdict: "confirmed", evidence: [{ path: "src/auth.ts", line: 11, quote: "requireRole(user, 'admin');" }], fix: "Keep the check.", reason: "Removed." })] },
    ]);
    const v = new ClaudeEvidenceVerifier({ model: "claude-opus-5", reader: async () => reader, client });
    const out = await v.verify(req);
    expect(out).toMatchObject({ verdict: "confirmed", fix: "Keep the check." });
    expect(out.costUsd).toBeCloseTo(2 * costUsd("claude-opus-5", usage));
    expect(v.id).toBe("claude-opus-5/verify-v1");
    // Fallbacks on, adaptive thinking, the hunks with line numbers, and the tool result fenced as data.
    expect(requests[0]).toMatchObject({ model: "claude-opus-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], thinking: { type: "adaptive" } });
    expect(JSON.stringify(requests[0]!.messages)).toContain("-11:   requireRole(user, 'admin');");
    expect(JSON.stringify(requests[1]!.messages)).toContain("<repo_data>");
  });

  it("a refusal or malformed verdict is unsure with an error, never confirmed", async () => {
    const refused = fakeClient([{ stop_reason: "refusal", content: [], stop_details: { type: "refusal", category: "cyber" } }]);
    expect(await new ClaudeEvidenceVerifier({ model: "claude-opus-5", reader: async () => reader, client: refused.client }).verify(req)).toMatchObject({
      verdict: "unsure",
      error: expect.stringContaining("cyber"),
    });
    const bad = fakeClient([{ stop_reason: "tool_use", content: [submit({ verdict: "definitely", evidence: [], reason: "x" })] }]);
    expect((await new ClaudeEvidenceVerifier({ model: "claude-opus-5", reader: async () => reader, client: bad.client }).verify(req)).verdict).toBe("unsure");
  });

  it("caps tool calls and nudges a model that answers in prose", async () => {
    const reads = Array.from({ length: 3 }, (_, i) => ({ type: "tool_use", id: `r${i}`, name: "list_dir", input: { path: "" } }));
    const { client, requests } = fakeClient([
      { stop_reason: "tool_use", content: reads },
      { stop_reason: "end_turn", content: [{ type: "text", text: "I think it's fine." }] },
      { stop_reason: "tool_use", content: [submit({ verdict: "not-confirmed", evidence: [], fix: null, reason: "The check moved." })] },
    ]);
    const out = await new ClaudeEvidenceVerifier({ model: "claude-opus-5", reader: async () => reader, client, maxToolCalls: 2 }).verify(req);
    expect(out.verdict).toBe("not-confirmed");
    const results = (requests[1]!.messages as Array<{ content: unknown }>).at(-1)!.content as Array<{ is_error?: boolean }>;
    expect(results.filter((r) => r.is_error)).toHaveLength(1);
    expect(JSON.stringify(requests[2]!.messages)).toContain("Call submit_verdict");
  });

  it("renders hunks with side and line numbers, and confines repo paths", () => {
    expect(renderHunks(req)).toContain("+11:   return;");
    expect(safeRepoPath("../etc/passwd")).toBeNull();
    expect(safeRepoPath("/etc/passwd")).toBeNull();
    expect(safeRepoPath("./src/a.ts")).toBe("src/a.ts");
    expect(numbered("a\nb\nc", 2, 3)).toBe("2: b\n3: c");
  });
});
