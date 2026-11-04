import { createHmac } from "node:crypto";
import { MemoryEvidenceStore, MemoryNonceLedger, parseConfig, verifyChain } from "@pullup/engine";
import { describe, expect, it } from "vitest";
import { logTail } from "./api";
import { collectRun } from "./collect";
import { FakeGitHub } from "./fake";
import { sendCheckRun, type SenderDeps } from "./send";
import { verifyWebhookSignature } from "./webhook";
import { junitFailures } from "./junit";
import { findHardFailures, findQuestions } from "@pullup/engine";

const config = parseConfig({ requiredWorkflows: ["ci"], ask: { to: "a@example.com" } });
const repo = "acme/shop";

function github() {
  const gh = new FakeGitHub();
  gh.runs.push({ repo, headSha: "s1", id: 10, name: "ci", status: "completed", conclusion: "success", runAttempt: 2, createdAt: "2026-11-04T10:00:00Z" });
  gh.runs.push({ repo, headSha: "s1", id: 11, name: "lint", status: "in_progress", conclusion: null, runAttempt: 1, createdAt: "2026-11-04T10:00:00Z" });
  gh.jobsByAttempt.set("10/1", [{ id: 1, name: "build", conclusion: "success" }, { id: 2, name: "test", conclusion: "failure" }]);
  // A rerun of the failed job only: "build" carried over with the same id.
  gh.jobsByAttempt.set("10/2", [{ id: 1, name: "build", conclusion: "success" }, { id: 3, name: "test", conclusion: "success" }]);
  gh.logs.set(2, "TimeoutError: page.waitForSelector: Timeout 5000ms exceeded.");
  gh.diffs.set(`${repo}#7`, "diff --git a/x b/x\n");
  return gh;
}

describe("collecting a commit's CI", () => {
  it("waits for required workflows only, then builds attempts per job with failed logs and the diff", async () => {
    const gh = github();
    gh.runs[0]!.status = "in_progress";
    expect(await collectRun(gh, { repo, headSha: "s1", pull: 7, config })).toEqual({ state: "waiting", pending: ["ci"] });
    gh.runs[0]!.status = "completed";
    const got = await collectRun(gh, { repo, headSha: "s1", pull: 7, config });
    if (got.state !== "ready") throw new Error("not ready");
    expect(got.run.jobs).toEqual([
      { workflow: "ci", name: "build", attempts: [{ conclusion: "success", failedTests: [], logExcerpt: "" }] },
      { workflow: "ci", name: "test", attempts: [{ conclusion: "failure", failedTests: [], logExcerpt: "TimeoutError: page.waitForSelector: Timeout 5000ms exceeded." }, { conclusion: "success", failedTests: [], logExcerpt: "" }] },
    ]);
    expect(got.run.diff).toBe("diff --git a/x b/x\n");
  });

  it("when forced, decides without a workflow that never ran and says so", async () => {
    const gh = github();
    const got = await collectRun(gh, { repo, headSha: "s1", pull: null, config: parseConfig({ requiredWorkflows: ["ci", "e2e"], ask: { to: "a" } }), force: true });
    if (got.state !== "ready") throw new Error("not ready");
    expect(got.run.jobs.every((j) => j.workflow === "ci")).toBe(true);
    expect(got.notes.join(" ")).toContain("Not finished when PullUp decided: e2e");
    expect(gh.calls).not.toContain("pullDiff");
  });

  it("trims GitHub's timestamps and keeps the end of a log", () => {
    const log = Array.from({ length: 100 }, (_, i) => `2026-11-04T10:00:00.1234567Z line ${i}`).join("\n");
    const tail = logTail(log);
    expect(tail.startsWith("line 40")).toBe(true);
    expect(tail.endsWith("line 99")).toBe(true);
  });
});

describe("test reports", () => {
  const XML = `<?xml version="1.0"?><testsuites><testsuite name="cart">
    <testcase classname="checkout.spec.ts" name="shows confirmation"><failure message="timeout">Timeout 5000ms</failure></testcase>
    <testcase classname="cart.test.ts" name="adds &amp; removes"><error>boom</error></testcase>
    <testcase classname="cart.test.ts" name="passes"/>
    <testcase classname="cart.test.ts" name="skipped"><skipped/></testcase>
  </testsuite></testsuites>`;

  it("reads failing and erroring test cases from JUnit XML", () => {
    expect(junitFailures(XML)).toEqual(["checkout.spec.ts > shows confirmation", "cart.test.ts > adds & removes"]);
  });

  it("names the failing tests of the latest attempt, so a known-flaky failure is a question, not a hard failure", async () => {
    const gh = github();
    gh.runs[0]!.runAttempt = 1;
    gh.reportFiles.set(10, new Map([["junit.xml", XML.replace(/<testcase classname="cart.test.ts" name="adds[\s\S]*?<\/testcase>/, "")]]));
    const known = parseConfig({ requiredWorkflows: ["ci"], flaky: { knownTests: ["checkout.spec.ts > shows confirmation"] }, ask: { to: "a" } });
    const got = await collectRun(gh, { repo, headSha: "s1", pull: 7, config: known });
    if (got.state !== "ready") throw new Error("not ready");
    const run = { ...got.run, diff: got.run.diff ?? "" } as Parameters<typeof findHardFailures>[0];
    expect(run.jobs.find((j) => j.name === "test")!.attempts[0]!.failedTests).toEqual(["checkout.spec.ts > shows confirmation"]);
    expect(findHardFailures(run, known)).toEqual([]);
    expect(findQuestions(run, known).map((q) => q.trigger)).toEqual(["flaky-test"]);
    expect(got.notes.join(" ")).not.toContain("pullup-reports");
    expect(got.rerunnable).toEqual([10]);
  });
});

describe("the governed sender", () => {
  const call = { repo, headSha: "s1", name: "PullUp", status: "completed" as const, conclusion: "neutral" as const, title: "Shadow: would pass", summary: "x" };
  const deps = (gh: FakeGitHub, over: Partial<SenderDeps> = {}) => ({ api: gh, permitKey: "k", ledger: new MemoryNonceLedger(), evidence: new MemoryEvidenceStore(), stopped: async () => false, ...over });

  it("sends with a permit, updates the same check run on a repeat, and records every step on a valid chain", async () => {
    const gh = github();
    const d = deps(gh);
    expect(await sendCheckRun(d, "r1", call)).toEqual({ sent: true, id: 1 });
    expect(await sendCheckRun(d, "r1", { ...call, title: "Shadow: would fail" })).toEqual({ sent: true, id: 1 });
    expect(gh.checkRuns).toHaveLength(1);
    expect(gh.checkRuns[0]!.title).toBe("Shadow: would fail");
    const store = d.evidence as MemoryEvidenceStore;
    expect(store.rows.map((r) => r.kind)).toEqual(["permit-issued", "sent", "permit-issued", "sent"]);
    expect(verifyChain(store.rows).ok).toBe(true);
  });

  it("sends nothing when the stop switch is on, without a permit key, or when GitHub refuses, and records why", async () => {
    for (const [over, reason] of [
      [{ stopped: async () => true }, "the stop switch is on"],
      [{ permitKey: null }, "no permit key is configured"],
    ] as const) {
      const gh = github();
      const d = deps(gh, over);
      expect(await sendCheckRun(d, "r1", call)).toEqual({ sent: false, reason });
      expect(gh.calls.filter((c) => c.includes("CheckRun"))).toEqual([]);
      expect((d.evidence as MemoryEvidenceStore).rows.map((r) => r.kind)).toEqual(["blocked"]);
    }
    const gh = github();
    gh.failWrites = true;
    const d = deps(gh);
    const result = await sendCheckRun(d, "r1", call);
    expect(result.sent).toBe(false);
    expect((d.evidence as MemoryEvidenceStore).rows.map((r) => r.kind)).toEqual(["permit-issued", "blocked"]);
  });
});

describe("webhook signatures", () => {
  it("accept only the App's own signature", () => {
    const body = '{"action":"completed"}';
    const sig = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyWebhookSignature("secret", body, sig)).toBe(true);
    expect(verifyWebhookSignature("secret", `${body} `, sig)).toBe(false);
    expect(verifyWebhookSignature("other", body, sig)).toBe(false);
    expect(verifyWebhookSignature("secret", body, null)).toBe(false);
    expect(verifyWebhookSignature("", body, sig)).toBe(false);
  });
});
