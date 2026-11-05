import { describe, expect, it } from "vitest";
import { testContext } from "../test-context";
import threatModel, { codeMapProblems } from ".";
import { parseThreatModel } from "./parse";

const MODEL = `# Security

Some text the parser ignores.

### In scope
| ID | Threat | Control | Code |
|----|--------|---------|------|
| T1 | Forged webhook | Constant-time signature check | \`src/webhook.ts\` → \`verifySignature\` |
| T2 | Session theft | Short sessions; secure cookies | \`src/auth/session.ts\`; \`src/auth/cookie.ts\` -> \`setCookie\` |

### Out of scope
- ARP spoofing: handled by the network layer.

### Operator contract
- \`tls-only\` — Serve only over TLS.

### Entry points
- \`src/routes/*.ts\`, \`fetch(\`, \`eval\`
`;

const config = threatModel.config.schema.parse({});
const files = (head = MODEL, base = MODEL) => [
  { path: "THREATS.md", text: base, from: "default" as const },
  { path: "THREATS.md", text: head, from: "head" as const },
];
const detect = (diff: string, f = files()) => threatModel.detect!(testContext(config, { diff, files: f }));

describe("parsing a threat model", () => {
  it("reads the four sections at any heading level, inside a larger file", () => {
    const m = parseThreatModel(MODEL);
    expect(m.problems).toEqual([]);
    expect(m.inScope.map((t) => [t.id, t.code])).toEqual([
      ["T1", [{ path: "src/webhook.ts", symbol: "verifySignature" }]],
      ["T2", [{ path: "src/auth/session.ts", symbol: null }, { path: "src/auth/cookie.ts", symbol: "setCookie" }]],
    ]);
    expect(m.outOfScope).toEqual([{ name: "ARP spoofing", reason: "handled by the network layer." }]);
    expect(m.contract).toEqual([{ key: "tls-only", text: "Serve only over TLS." }]);
    expect(m.entryPoints).toEqual({ globs: ["src/routes/*.ts"], code: ["fetch(", "eval"] });
  });

  it("names every problem: a short row, a duplicate id, no code, no sections", () => {
    const bad = MODEL.replace("| T2 | Session theft | Short sessions; secure cookies | `src/auth/session.ts`; `src/auth/cookie.ts` -> `setCookie` |", "| T1 | Again | x | `a.ts` |\n| T3 | No code | x | none |\n| T4 | Short |");
    expect(parseThreatModel(bad).problems).toEqual(["line 9: threat ID T1 is used twice.", "line 10: T3 has no code in backticks in its Code column.", "line 11: row has 2 columns, the table has 4."]);
    expect(parseThreatModel("# Readme\nnothing here").problems).toEqual(["no In scope, Out of scope, Operator contract or Entry points heading was found."]);
  });
});

describe("the threat model checks", () => {
  it("a change inside a mapped function asks about that control, with the threat as seat context, a fact and an annotation", () => {
    const d = detect("--- a/src/webhook.ts\n+++ b/src/webhook.ts\n@@ -5,1 +5,1 @@ export function verifySignature(body: string) {\n-  return safeEqual(a, b);\n+  return a === b;\n");
    expect(d.questions).toHaveLength(1);
    expect(d.questions![0]).toMatchObject({ key: "T1", councilMayPass: false, prompt: "Does this change weaken the control for T1 (Forged webhook)?" });
    expect(d.questions![0]!.seatContext).toContain("Control: Constant-time signature check");
    expect(d.facts).toEqual([{ kind: "threat-touched", id: "T1" }]);
    expect(d.annotations).toEqual([{ path: "src/webhook.ts", line: 5, message: "This code implements the control for T1 (Forged webhook): Constant-time signature check", level: "warning" }]);
  });

  it("a mapped file with no function named counts any change; the council may pass controls only when the repository says so", () => {
    const diff = "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1 +1 @@\n-const MAX_AGE = 1;\n+const MAX_AGE = 30;\n";
    expect(detect(diff).questions!.map((q) => q.key)).toEqual(["T2"]);
    const loose = threatModel.detect!(testContext({ ...config, controlsCouncilMayPass: true }, { diff, files: files() }));
    expect(loose.questions![0]!.councilMayPass).toBe(true);
  });

  it("removing a mapped function is drift, not a control question", () => {
    const d = detect("--- a/src/auth/cookie.ts\n+++ b/src/auth/cookie.ts\n@@ -1,1 +1,1 @@\n-export function setCookie(res) {\n+export function setSessionCookie(res) {\n");
    expect(d.questions!.map((q) => [q.key, q.councilMayPass, q.summary])).toEqual([["drift-T2", false, "Code map drift for T2: setCookie is removed from src/auth/cookie.ts."]]);
  });

  it("a new route file or an added line with a code pattern is a new entry point, unless the file is mapped", () => {
    expect(detect("--- /dev/null\n+++ b/src/routes/admin.ts\n@@ -0,0 +1 @@\n+export const x = 1;\n").questions!.map((q) => q.key)).toEqual(["entry-point"]);
    expect(detect("--- a/src/lib/a.ts\n+++ b/src/lib/a.ts\n@@ -1 +1 @@\n-x\n+eval(code)\n").questions![0]!.summary).toBe("New entry points: src/lib/a.ts (eval).");
    expect(detect("--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1 +1 @@\n-x\n+await fetch(url)\n").questions!.map((q) => q.key)).toEqual(["T2"]);
  });

  it("an edit to the threat model that removes a threat, moves one out of scope, drops a contract item or breaks the file is a loosening", () => {
    const edit = "--- a/THREATS.md\n+++ b/THREATS.md\n@@ -1 +1 @@\n-x\n+y\n";
    const moved = MODEL.replace(/\| T1 .*\n/, "").replace("- ARP spoofing", "- Forged webhook: the proxy checks it.\n- ARP spoofing").replace(/- `tls-only`.*\n/, "");
    expect(detect(edit, files(moved)).questions![0]!.summary).toBe("Threat model: T1 (Forged webhook) is moved out of scope; operator contract item `tls-only` is removed.");
    expect(detect(edit, files(MODEL.replace("`src/auth/session.ts`; ", ""))).questions!.map((q) => q.key)).toEqual([]);
    expect(detect(edit, files("# Notes")).questions![0]!.summary).toMatch(/can no longer be read/);
    expect(detect("--- a/THREATS.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n", [files()[0]!]).questions![0]!.summary).toBe("Threat model: the threat model file is deleted.");
  });

  it("no threat model, or one that cannot be read: no questions, and a note saying the checks did not run", () => {
    const touch = "--- a/src/webhook.ts\n+++ b/src/webhook.ts\n@@ -5,1 +5,1 @@ export function verifySignature(body: string) {\n-a\n+b\n";
    expect(detect(touch, [])).toEqual({});
    expect(threatModel.notes!(testContext(config, { files: [] }))).toEqual([{ text: "No THREATS.md on the default branch, so the threat model checks did not run." }]);
    const broken = files("# x", "## In scope\n| ID | Threat |\n| T1 | x |");
    expect(detect(touch, broken).questions).toEqual([]);
    expect(threatModel.notes!(testContext(config, { files: broken }))[0]!.text).toMatch(/could not be read, so its checks did not run: line 2: the In scope table needs/);
  });

  it("checks a code map against the files of a commit", () => {
    const m = parseThreatModel(MODEL);
    const tree: Record<string, string> = { "src/webhook.ts": "export function verifySignature() {}", "src/auth/session.ts": "", "src/auth/cookie.ts": "export function setSessionCookie() {}" };
    expect(codeMapProblems(m, (p) => tree[p] ?? null)).toEqual(["T2: src/auth/cookie.ts does not define setCookie."]);
  });
});
