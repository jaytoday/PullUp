import { defineEvalConfig } from "eve/evals";

/**
 * Eval defaults. `t.judge(...)` grades with eve's default evaluation model
 * (`typesafe-ai/jev`, via the AI Gateway) — a separate model from the agent
 * under test, so no judge override is needed. Provider language models can't
 * be used as the judge (eve 0.62+).
 */
export default defineEvalConfig({});
