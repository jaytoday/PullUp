import { defineEval } from "eve/evals";

/**
 * Offline fixture eval: the congested fixture must come out with a longer
 * congestion-inflated waiting-cost rate and (mechanically) tighter w* than the
 * healthy fixture — the agent should surface the congestion effect.
 */
export default defineEval({
  description:
    "Agent distinguishes healthy vs congested fixture economics (congestion raises waiting cost).",
  async test(t) {
    const turn = await t.send(`
Ingest fixtures/healthy.json as "fixtures/healthy" and fixtures/congested.json as
"fixtures/congested". For each, run two_cost. Compare the two: how does queue
congestion change the waiting-cost rate r_v and the max-wait thresholds w*?
Explain the mechanism in the two-cost model.`);
    turn.succeeded();
    t.calledTool("ingest_repo");
    t.calledTool("two_cost", { count: (n) => n >= 2 });
    t.judge(
      "Did the assistant (1) report each fixture's congestion queue depth and r_v from its two_cost output, (2) explain that higher congestion inflates r_v and therefore lowers w* (waiting is more expensive when the queue is backed up), and (3) ground every figure in the tool outputs without inventing numbers?"
    ).gate(0.7);
  },
});
