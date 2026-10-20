import { describe, expect, it } from "vitest";
import type { AuthorityLevel } from "../actions/authority.js";
import type { BotReviewAction } from "../actions/review.js";
import { InMemoryStore } from "../schema/store.js";
import { authorize, type AuthorizationContext } from "./authorize.js";
import { agentIdentity } from "./composition.js";
import { appendEvidence, verifyEvidenceChain } from "./evidence.js";
import { issuePermit, resolvePermitKey, verifyPermit } from "./permit.js";
import { CAPABILITY_PROFILES, PROFILE_CEILING } from "./profiles.js";

const NOW = "2026-10-05T12:00:00.000Z";
const ctx = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
  profile: "review",
  agentStatus: "approved",
  stop: { stopped: false, reason: "" },
  delivery: "live",
  credential: "app",
  permitKey: true,
  ...over,
});
const ACTIONS: BotReviewAction[] = ["approve", "request_changes", "defer_to_human"];
const LEVELS: AuthorityLevel[] = ["off", "comment", "act"];
const RANK = { off: 0, comment: 1, act: 2 } as const;

describe("authorize", () => {
  it("never raises a level, for every profile × action × requested level × agent status × credential", () => {
    for (const profile of CAPABILITY_PROFILES)
      for (const action of ACTIONS)
        for (const requested of LEVELS)
          for (const agentStatus of ["approved", "pending"] as const)
            for (const credential of ["app", "standing-token"] as const) {
              const a = authorize({ action }, requested, ctx({ profile, agentStatus, credential }));
              expect(RANK[a.effective]).toBeLessThanOrEqual(RANK[requested]);
              const key = action === "approve" ? "approve" : action === "request_changes" ? "requestChanges" : "requestHuman";
              expect(RANK[a.effective]).toBeLessThanOrEqual(RANK[PROFILE_CEILING[profile][key]]);
              if (agentStatus === "pending" || credential === "standing-token") expect(a.effective).not.toBe("act");
            }
  });

  it("denies (fails closed) on every missing or bad input", () => {
    expect(authorize({ action: "approve" }, "act", ctx({ stop: null })).decision).toBe("deny");
    expect(authorize({ action: "approve" }, "act", ctx({ stop: { stopped: true, reason: "x" } })).decision).toBe("deny");
    expect(authorize({ action: "approve" }, "act", ctx({ agentStatus: "unknown" })).decision).toBe("deny");
    expect(authorize({ action: "approve" }, "act", ctx({ agentStatus: "quarantined" })).decision).toBe("deny");
    expect(authorize({ action: "approve" }, "act", ctx({ permitKey: false })).decision).toBe("deny");
    expect(authorize({ action: "approve" }, "act", ctx({ credential: null })).decision).toBe("deny");
    // Log mode needs neither a key nor a credential: nothing is sent.
    expect(authorize({ action: "approve" }, "act", ctx({ delivery: "log", permitKey: false, credential: null })).decision).toBe("allow");
  });

  it("asks for the minimum GitHub permissions", () => {
    expect(authorize({ action: "approve" }, "act", ctx()).permissions).toEqual({ pull_requests: "write" });
    expect(authorize({ action: "approve" }, "comment", ctx()).permissions).toEqual({ pull_requests: "read", issues: "write" });
    expect(authorize({ action: "defer_to_human" }, "act", ctx()).permissions).toEqual({ pull_requests: "write", issues: "write" });
    expect(authorize({ action: "approve" }, "off", ctx()).permissions).toEqual({});
  });
});

describe("permits", () => {
  const claims = {
    taskId: "t1",
    repoId: "a/b",
    pullNumber: 1,
    headSha: "s",
    action: "approve" as const,
    level: "act" as const,
    configHash: "h",
    agentId: "pullup/cli",
    agentVersion: "v",
    permissions: { pull_requests: "write" as const },
    callHash: "c",
  };

  it("verifies only with the same key, before expiry", () => {
    const p = issuePermit(claims, "k", { now: NOW });
    expect(verifyPermit(p, "k", NOW)).toBeNull();
    expect(verifyPermit(p, "other", NOW)).toMatch(/signature/);
    expect(verifyPermit(p, null, NOW)).toMatch(/PULLUP_PERMIT_KEY/);
    expect(verifyPermit(p, "k", "2026-10-05T12:05:00.000Z")).toMatch(/expired/);
    expect(verifyPermit({ ...p, claims: { ...p.claims, pullNumber: 2 } }, "k", NOW)).toMatch(/signature/);
    expect(verifyPermit(undefined, "k", NOW)).toMatch(/no permit/);
  });

  it("reads the key from the environment only when set", () => {
    expect(resolvePermitKey({})).toBeNull();
    expect(resolvePermitKey({ PULLUP_PERMIT_KEY: "  " })).toBeNull();
    expect(resolvePermitKey({ PULLUP_PERMIT_KEY: "abc" })).toBe("abc");
  });
});

describe("composition hash", () => {
  it("changes when instructions, tools, model or question set change — and only then", () => {
    const base = { id: "pullup/eve", files: { "instructions.ts": "be careful" }, modelId: "m1", coreVersion: "0.1.0" };
    const v = agentIdentity(base).version;
    expect(agentIdentity(base).version).toBe(v);
    expect(agentIdentity({ ...base, files: { "instructions.ts": "be bold" } }).version).not.toBe(v);
    expect(agentIdentity({ ...base, files: { ...base.files, "tools/x.ts": "" } }).version).not.toBe(v);
    expect(agentIdentity({ ...base, modelId: "m2" }).version).not.toBe(v);
    expect(agentIdentity({ ...base, questionSetVersion: "q-v2" }).version).not.toBe(v);
    expect(agentIdentity({ ...base, id: "pullup/cli" }).version).not.toBe(v);
  });
});

describe("evidence chain", () => {
  it("links rows per repo and detects edits", async () => {
    const store = new InMemoryStore();
    for (const repoId of ["a/b", "a/b", "c/d"]) {
      await appendEvidence(store, { repoId, taskId: "t", agentVersion: null, kind: "planned", at: NOW, payload: { n: 1 } });
    }
    const rows = await store.listEvidence();
    expect(rows.map((r) => `${r.repoId}#${r.seq}`)).toEqual(["a/b#1", "a/b#2", "c/d#1"]);
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(verifyEvidenceChain(rows).ok).toBe(true);
    store.tamperEvidence((all) => all.map((r, i) => (i === 0 ? { ...r, at: "2020-01-01T00:00:00.000Z" } : r)));
    expect(verifyEvidenceChain(await store.listEvidence()).breaks.map((b) => b.seq)).toEqual([1]);
  });
});
