import { configInput, parseConfig } from "@pullup/engine";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, migrateDb } from "@/lib/db/client";
import { runs, settings } from "@/lib/db/schema";
import { decidedBy } from "./dashboard";
import { discardDraft, extensionsEditor, saveDraft } from "./extensions";

const repo = "acme/shop";
const committed = parseConfig({ requiredWorkflows: ["ci"], ask: { to: "owner@example.com" } });

beforeAll(migrateDb);
beforeEach(async () => {
  for (const t of [runs, settings]) await db.delete(t);
  await db.insert(runs).values({ id: "r1", repo, headSha: "s1", pull: 7, state: "decided", mode: "shadow", firstSeenAt: new Date("2026-11-04T10:00:00Z"), config: committed });
});

describe("extension settings drafts", () => {
  it("starts from the committed config and keeps a saved draft until it is discarded", async () => {
    expect((await extensionsEditor(repo)).committed).toEqual(configInput(committed));
    const { file } = await saveDraft(repo, { core: {}, "threat-model": { mode: "shadow" } }, "");
    expect(file.extensions["threat-model"]).toMatchObject({ mode: "shadow", path: "THREATS.md" });
    expect((await extensionsEditor(repo)).draft).toEqual(file);
    await discardDraft(repo);
    expect((await extensionsEditor(repo)).draft).toBeNull();
  });

  it('refuses a loosening unless "loosen" is typed, and a setting that does not exist', async () => {
    const loose = { core: { mode: "shadow" } };
    await expect(saveDraft(repo, loose, "")).rejects.toThrow(/type "loosen"/);
    expect((await saveDraft(repo, loose, "loosen")).loosenings).toEqual(["Core checks (core) is in Shadow mode."]);
    await expect(saveDraft(repo, { "threat-model": { nope: true } }, "")).rejects.toThrow(/nope/);
  });

  it("refuses to save before PullUp has read the repository's config", async () => {
    await expect(saveDraft("acme/other", {}, "")).rejects.toThrow(/has not read/);
  });
});

describe("who settled a run", () => {
  it("a run with only Shadow questions was settled by nothing tricky, not the council", () => {
    const q = (shadow: boolean) => ({ question: { id: "x:q", extension: "x", key: "q", prompt: "p", summary: "s", evidence: [], councilMayPass: true, shadow }, seats: [], outcome: "ask", decidedBy: null, reason: "" });
    const row = (shadow: boolean) => ({ state: "decided", result: "pass", mode: "active", decision: { result: "pass", reason: "", hardFailures: [], questions: [q(shadow)], councilCalls: 0, costUsd: 0, extensions: null } }) as never;
    expect(decidedBy(row(true), {})).toBe("nothing tricky (Shadow questions only)");
    expect(decidedBy(row(false), {})).toBe("the council");
  });
});
