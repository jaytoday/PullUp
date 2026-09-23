import { defineEval } from "eve/evals";

/**
 * Negative coverage: a plain greeting is answered conversationally — no domain
 * tools, no invented repo analytics (guards over-eager tool use).
 */
export default defineEval({
  description: "A greeting is answered conversationally without calling domain tools.",
  async test(t) {
    await t.send("Hi there — what can you help me with?");
    t.succeeded();
    t.usedNoTools().soft();
  },
});
