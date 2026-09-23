import { defineEval } from "eve/evals";

type Triage = {
  model?: string | null;
  signalRun?: { failed?: number } | null;
  pulls?: Array<{ pullNumber: number; risk?: { band?: string } | null }>;
};

/**
 * LIVE: real Jev (TYPESAFE_API_KEY) on the scenario fixture. Skipped without a
 * key. Checks the pinned model answered every unit and that the two
 * unambiguous cases land where the policy + auth signal say they must.
 * Record a replay for offline use with:
 *   pnpm pullup signals fixtures/jev --model jev --record fixtures/jev.replay.json
 */
export default defineEval({
  description: "Live Jev triage of the scenario fixture (pinned model, no failed units).",
  tags: ["live"],
  async test(t) {
    if (!process.env.TYPESAFE_API_KEY) t.skip("TYPESAFE_API_KEY not set");
    const turn = await t.send(`
Ingest fixtures/jev.json as "fixtures/jev", then triage all open PRs in shadow
mode and summarise the escalations.`);
    turn.succeeded();
    t.calledTool("triage_pull", {
      output: (out) => {
        const o = out as Triage;
        const band = (n: number) => o.pulls?.find((p) => p.pullNumber === n)?.risk?.band;
        return (
          o.model === "jev-1.13.0" &&
          (o.signalRun?.failed ?? 0) === 0 &&
          band(1001) === "escalate" &&
          band(1004) === "escalate"
        );
      },
    }).gate();
  },
});
