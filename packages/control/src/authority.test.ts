import { describe, expect, it } from "vitest";
import type { AuthorityContext } from "./authority.js";
import { authorize } from "./authority.js";

const ok: AuthorityContext = {
  profile: "act-within-limits",
  limits: { maxActAmount: 2500 },
  agentStatus: "approved",
  stop: { stopped: false, reason: "" },
  autoGatePassed: true,
  fairnessGatePassed: true,
  delivery: "live",
  permitKey: true,
};

describe("authorize", () => {
  it("allows a favorable action inside every limit", () => {
    expect(authorize({ action: "approve", amount: 500 }, ok)).toMatchObject({ decision: "allow", effective: "act" });
  });

  it.each([
    ["profile refer-only", { profile: "refer-only" as const }],
    ["auto gate failed", { autoGatePassed: false }],
    ["fairness failed", { fairnessGatePassed: false }],
    ["no fairness report", { fairnessGatePassed: null }],
    ["agent pending", { agentStatus: "pending" as const }],
  ])("lowers approval to a person when %s", (_, change) => {
    expect(authorize({ action: "approve", amount: 500 }, { ...ok, ...change })).toMatchObject({ decision: "lowered", effective: "route-to-person" });
  });

  it("lowers approval above the amount limit", () => {
    const a = authorize({ action: "approve", amount: 9000 }, ok);
    expect(a.effective).toBe("route-to-person");
    expect(a.reasons.join(" ")).toContain("above the automatic limit");
  });

  it("never acts on an adverse decision", () => {
    expect(authorize({ action: "adverse", amount: 10 }, ok).effective).toBe("route-to-person");
  });

  it("observe records only", () => {
    expect(authorize({ action: "refer", amount: 10 }, { ...ok, profile: "observe" }).effective).toBe("none");
  });

  it.each([
    ["stop switch on", { stop: { stopped: true, reason: "incident" } }],
    ["stop switch unreadable", { stop: null }],
    ["agent quarantined", { agentStatus: "quarantined" as const }],
    ["agent unknown", { agentStatus: "unknown" as const }],
    ["live without permit key", { permitKey: false }],
  ])("denies everything when %s", (_, change) => {
    expect(authorize({ action: "refer", amount: 10 }, { ...ok, ...change })).toMatchObject({ decision: "deny", effective: "none" });
  });

  it("denies an invalid amount", () => {
    expect(authorize({ action: "approve", amount: Number.NaN }, ok).decision).toBe("deny");
  });
});
