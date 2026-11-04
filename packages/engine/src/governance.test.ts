import { describe, expect, it } from "vitest";
import { appendEvidence, MemoryEvidenceStore, verifyChain } from "./evidence";
import { checkPermit, issuePermit, MemoryNonceLedger } from "./permit";

const KEY = "test-permit-key";
const call = { repo: "acme/shop", head_sha: "abc", conclusion: "neutral" };

describe("permits", () => {
  it("cover one exact call, once, before they expire, with the right key", async () => {
    const now = new Date("2026-11-04T10:00:00Z");
    const ledger = new MemoryNonceLedger();
    const permit = issuePermit("acme/shop", "check-run", call, KEY, now);
    expect(await checkPermit(permit, { ...call, conclusion: "success" }, { key: KEY, now, ledger })).toBe("permit does not cover this call");
    expect(await checkPermit(permit, call, { key: "other", now, ledger })).toBe("permit signature is invalid");
    expect(await checkPermit(permit, call, { key: KEY, now: new Date(now.getTime() + 6 * 60_000), ledger })).toMatch(/expired/);
    expect(await checkPermit(undefined, call, { key: KEY, now, ledger })).toMatch(/no permit/);
    expect(await checkPermit(permit, call, { key: null, now, ledger })).toMatch(/no permit key/);
    expect(await checkPermit(permit, call, { key: KEY, now, ledger })).toBeNull();
    expect(await checkPermit(permit, call, { key: KEY, now, ledger })).toBe("permit was already used");
  });
});

describe("the evidence chain", () => {
  it("links rows per repository and shows an edited or missing row", async () => {
    const store = new MemoryEvidenceStore();
    for (const kind of ["collected", "decided", "sent"] as const) {
      await appendEvidence(store, { scope: "acme/shop", runId: "r1", kind, at: "2026-11-04T10:00:00Z", payload: { kind } });
      await appendEvidence(store, { scope: "acme/other", runId: "r2", kind, at: "2026-11-04T10:00:00Z", payload: {} });
    }
    expect(verifyChain(store.rows)).toEqual({ ok: true, breaks: [] });
    const edited = store.rows.map((r) => (r.scope === "acme/shop" && r.seq === 2 ? { ...r, payload: { kind: "changed" } } : r));
    expect(verifyChain(edited).breaks).toEqual([{ scope: "acme/shop", seq: 2, problem: "row content does not match its hash (edited)" }]);
    const missing = store.rows.filter((r) => !(r.scope === "acme/shop" && r.seq === 2));
    expect(verifyChain(missing).ok).toBe(false);
  });
});
