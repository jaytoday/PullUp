import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "./pullup";

const NO_WITHAI = {} as NodeJS.ProcessEnv;

function repoWithBranch(): string {
  const dir = mkdtempSync(join(tmpdir(), "pullup-check-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  const write = (path: string, text: string) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  write(".pullup/config.json", JSON.stringify({ requiredWorkflows: ["ci"], ask: { to: "owner@example.com" } }));
  write("src/auth/session.ts", "export const MAX_AGE = 60 * 60 * 24;\n");
  git("add", ".");
  git("commit", "-q", "-m", "start");
  git("checkout", "-q", "-b", "change");
  // The branch tries to switch the sensitive path trigger off for itself.
  write(".pullup/config.json", JSON.stringify({ requiredWorkflows: ["ci"], triggers: { "sensitive-path": { enabled: false } }, ask: { to: "me@example.com" } }));
  write("src/auth/session.ts", "export const MAX_AGE = 60 * 60 * 24 * 30;\n");
  git("commit", "-q", "-am", "longer sessions");
  return dir;
}

describe("pullup check", () => {
  it("replays recorded council answers for a fixture with no WithAI call", async () => {
    const { text, decision } = await check(["--fixture", "fixtures/sensitive-auth.json", "--replay", "fixtures/recorded/sensitive-auth.json"], NO_WITHAI);
    expect(decision.councilCalls).toBe(4);
    expect(decision.questions[0]!.seats.some((s) => s.problems.includes("call failed: no recorded answer for this question"))).toBe(false);
    expect(text).toContain("question (core:sensitive-path)");
    expect(text).toMatch(/RESULT: (PASS|FAIL|WAITING)/);
  });

  it("every recorded live council replays fully, and each recorded fail rests on a quote that checks out", async () => {
    for (const name of readdirSync("fixtures/recorded")) {
      const { decision } = await check(["--fixture", `fixtures/${name}`, "--replay", `fixtures/recorded/${name}`], NO_WITHAI);
      const seats = decision.questions.flatMap((q) => q.seats);
      expect(seats.flatMap((s) => s.problems).filter((p) => p.startsWith("call failed")), name).toEqual([]);
      for (const q of decision.questions.filter((x) => x.outcome === "fail")) expect(q.seats.some((s) => s.verdict === "fail" && s.validQuotes.length > 0), name).toBe(true);
    }
  });

  it("a hard failure needs no council at all", async () => {
    const { decision } = await check(["--fixture", "fixtures/hard-fail-repeat.json"], NO_WITHAI);
    expect(decision).toMatchObject({ result: "fail", councilCalls: 0 });
  });

  it("on a local branch, reads config from the default branch and ignores the branch's own", async () => {
    const dir = repoWithBranch();
    const { text, decision } = await check(["--base", "main"], NO_WITHAI, dir);
    expect(decision.questions.map((q) => q.question.id)).toEqual(["core:sensitive-path"]);
    expect(decision.result).toBe("waiting");
    expect(text).toContain("would ask owner@example.com");
    expect(text).toContain("differs from main; it is ignored");
    expect(text).toContain("required workflows are assumed to have passed");
  });

  it("refuses to run when the default branch has no config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pullup-check-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"], { cwd: dir });
    await expect(check(["--base", "main"], NO_WITHAI, dir)).rejects.toThrow("No .pullup/config.json on main");
  });
});
