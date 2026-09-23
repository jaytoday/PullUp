import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";

// PullUp's root agent: a dynamic-CI analyst that reads a repo's PR history and
// reports the cost of waiting for human review vs the cost of shipping a bug,
// with a per-PR max-wait threshold. All the numbers come from the deterministic
// @pullup/core engine — this agent only interprets and posts them.
//
// Direct Anthropic call (ANTHROPIC_API_KEY), same wiring as theory/withai-eve.
// Override the model with PULLUP_MODEL.
export default defineAgent({
  model: anthropic(process.env.PULLUP_MODEL || "claude-sonnet-4-6"),
  // The direct provider id isn't in eve's gateway catalog; give compaction the
  // context window explicitly (Sonnet = 200k).
  modelContextWindowTokens: 200_000,
  // Medium reasoning: the agent picks which analysis to run and how to phrase
  // the recommendation, but the cost math itself is deterministic.
  reasoning: "medium",
});
