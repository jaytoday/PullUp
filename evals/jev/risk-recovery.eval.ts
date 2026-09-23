import { defineEval } from "eve/evals";

type Triage = { pulls?: Array<{ pullNumber: number; risk?: { band?: string } | null }> };

/**
 * Offline recovery: the bands the agent reports for the scenario PRs must be
 * the engine's bands, and it must disclose the synthetic stand-in model.
 */
export default defineEval({
  description: "Agent reports the engine's Jev bands for the scenario PRs without inventing any.",
  async test(t) {
    const turn = await t.send(`
Ingest fixtures/jev.json as "fixtures/jev", triage all open PRs in shadow mode,
and list PRs #1001–#1005 with the band each landed in. What does the fast-path
band mean for approval — is anything actually posted to GitHub?`);
    turn.succeeded();
    t.calledTool("triage_pull", {
      input: { repoId: "fixtures/jev" },
      output: (out) => {
        const band = (n: number) => (out as Triage).pulls?.find((p) => p.pullNumber === n)?.risk?.band;
        return (
          band(1001) === "escalate" &&
          band(1002) === "escalate" &&
          band(1004) === "escalate" &&
          band(1003) === "fast-path" &&
          band(1005) === "fast-path"
        );
      },
    }).gate();
    t.notCalledTool("log_review_action");
    t.judge(
      "Does the assistant report #1001, #1002 and #1004 as escalate and #1003 and #1005 as fast-path, explain that a fast-path approval is stubbed (logged only, never posted to GitHub), and mention that a synthetic stand-in model (not live Jev) produced the signals?",
    ).gate(0.7);
  },
});
