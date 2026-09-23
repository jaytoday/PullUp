import { defineEval } from "eve/evals";

/**
 * Recovery eval (offline, fixtures): the agent must analyze fixtures/healthy
 * and report the per-change-type max-wait thresholds w* with the same
 * *relative* ordering the deterministic engine computes — never invented
 * numbers. Covers the two-cost model + per-PR threshold (KTD2/KTD4).
 */
export default defineEval({
  description:
    "Agent grounds w* thresholds in the fixture analysis (recovery of the two-cost model).",
  async test(t) {
    const turn = await t.send(`
Ingest the repo at fixtures/healthy.json as "fixtures/healthy", analyze it, then
use the two-cost model to tell me: which change type has the longest max-wait
threshold (w*) and which has the shortest, and why the model makes it so.
Quote the actual w* hours for each type from the tool output.`);
    turn.succeeded();
    t.calledTool("ingest_repo");
    t.calledTool("analyze_repo");
    t.calledTool("two_cost");
    t.judge(
      "Did the assistant (1) quote per-change-type w* hours that match its two_cost maxWaitByType output, (2) correctly identify the longest and shortest w* type, and (3) explain the reason in terms of the two-cost model (waiting cost D(w) vs shipping-before-review cost E(w)) without inventing any figures?"
    ).gate(0.7);
  },
});
