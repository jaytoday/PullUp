import { parseConfig } from "@pullup/engine";
import { FakeGitHub } from "@pullup/github";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, migrateDb } from "@/lib/db/client";
import { repos, runs, settings } from "@/lib/db/schema";
import { checkThreatDrift, checkThreatDriftDaily, threatDrift } from "./threat-drift";

const repo = "acme/shop";
const T0 = new Date("2026-11-05T10:00:00Z");
const MODEL = "## In scope\n| ID | Threat | Control | Code |\n| --- | --- | --- | --- |\n| T1 | Forged webhook | Signature | `src/webhook.ts` → `verifySignature` |\n| T2 | Replay | Ids | `src/deliveries.ts` |\n";

beforeAll(migrateDb);
beforeEach(async () => {
  for (const t of [runs, repos, settings]) await db.delete(t);
  await db.insert(repos).values({ fullName: repo, createdAt: T0 });
  const config = parseConfig({ requiredWorkflows: ["ci"], ask: { to: "a@example.com" }, extensions: { "threat-model": { mode: "shadow" } } });
  await db.insert(runs).values({ id: "r1", repo, headSha: "s1", pull: 1, state: "decided", mode: "shadow", firstSeenAt: T0, config });
});

describe("the daily threat model check", () => {
  it("finds code map drift on the default branch and keeps the result for Settings", async () => {
    const gh = new FakeGitHub();
    gh.files.set(repo, { "THREATS.md": MODEL, "src/webhook.ts": "export function verifySignatureV2() {}" });
    const result = await checkThreatDrift(gh, repo, T0);
    expect(result!.problems).toEqual(["T1: src/webhook.ts does not define verifySignature.", "T2: src/deliveries.ts does not exist."]);
    expect(await threatDrift(repo)).toEqual(result);
    gh.files.set(repo, { "THREATS.md": MODEL, "src/webhook.ts": "export function verifySignature() {}", "src/deliveries.ts": "" });
    expect((await checkThreatDrift(gh, repo, T0))!.problems).toEqual([]);
  });

  it("a missing threat model or a failed read is a problem, never a clean result", async () => {
    const gh = new FakeGitHub();
    expect((await checkThreatDrift(gh, repo, T0))!.problems).toEqual(["THREATS.md is not on the default branch."]);
    gh.readFiles = async () => {
      throw new Error("rate limited");
    };
    expect((await checkThreatDrift(gh, repo, T0))!.problems).toEqual(["Could not read the default branch: rate limited"]);
  });

  it("runs at most once a day, and skips repositories without the extension", async () => {
    const gh = new FakeGitHub();
    gh.files.set(repo, { "THREATS.md": MODEL });
    expect(await checkThreatDriftDaily(gh, T0)).toBe(1);
    expect(await checkThreatDriftDaily(gh, new Date(T0.getTime() + 60 * 60_000))).toBe(0);
    expect(await checkThreatDriftDaily(gh, new Date(T0.getTime() + 25 * 60 * 60_000))).toBe(1);
    await db.update(runs).set({ config: parseConfig({ requiredWorkflows: ["ci"], ask: { to: "a@example.com" } }) });
    expect(await checkThreatDrift(gh, repo, T0)).toBeNull();
  });
});
