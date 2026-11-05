import type { Question } from "@pullup/sdk";
import { describe, expect, it } from "vitest";
import { testContext } from "../test-context";
import codeowners, { ownersOf, parseCodeowners } from ".";

const FILE = `# Owners
*               @acme/everyone
/src/auth/      @alice @bob
*.sql           dba@example.com
docs            @carol   # any docs folder
/src/billing/invoice.ts @dave
`;

const question = (...paths: string[]): Question => ({
  id: "core:sensitive-path", extension: "core", key: "sensitive-path", prompt: "p", summary: "s", councilMayPass: false, shadow: false,
  evidence: paths.map((where) => ({ source: "diff" as const, where, line: 1, text: "x" })),
});
const config = codeowners.config.schema.parse({ people: { "@alice": "alice@example.com", bob: "member_bob", "@acme/everyone": "team@example.com" } });
const ctx = (text = FILE, path = ".github/CODEOWNERS") => testContext(config, { files: [{ path, text, from: "default" }] });

describe("CODEOWNERS", () => {
  it("matches like GitHub: anchored folders, patterns at any depth, and the last matching rule wins", () => {
    const rules = parseCodeowners(FILE);
    expect(ownersOf(rules, "src/auth/session.ts")).toEqual(["@alice", "@bob"]);
    expect(ownersOf(rules, "lib/src/auth/x.ts")).toEqual(["@acme/everyone"]);
    expect(ownersOf(rules, "db/migrations/1.sql")).toEqual(["dba@example.com"]);
    expect(ownersOf(rules, "packages/a/docs/readme.md")).toEqual(["@carol"]);
    expect(ownersOf(rules, "src/billing/invoice.ts")).toEqual(["@dave"]);
  });

  it("asks the mapped owners of the question's files, at most maxPeople, and email owners as they are", () => {
    expect(codeowners.recipients!(ctx(), question("src/auth/session.ts"))).toEqual(["alice@example.com", "member_bob"]);
    expect(codeowners.recipients!(ctx(), question("db/1.sql", "src/auth/a.ts"))).toEqual(["dba@example.com", "alice@example.com"]);
  });

  it("falls through (null) when no owner is mapped, there is no CODEOWNERS file, or the question has no file", () => {
    expect(codeowners.recipients!(ctx(), question("src/billing/invoice.ts"))).toBeNull();
    expect(codeowners.recipients!(testContext(config), question("src/auth/a.ts"))).toBeNull();
    expect(codeowners.recipients!(ctx(), { ...question(), evidence: [{ source: "log", where: "ci / test", line: null, text: "x" }] })).toBeNull();
  });

  it("notes owners with no WithAI person, and a missing file", () => {
    expect(codeowners.notes!(ctx())).toEqual([{ text: "Code owners with no WithAI person in codeowners.people (questions for their files go to ask.to): @carol, @dave." }]);
    expect(codeowners.notes!(testContext(config))).toEqual([{ text: "No CODEOWNERS file on the default branch: questions go to ask.to." }]);
  });
});
