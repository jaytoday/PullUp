# The agent

Back to the [overview](README.md). Code: `src/server/agent/`.

PullUp's agent is a small tool-using loop with a CI reviewer's system prompt (`src/server/agent/prompt.md`). It decides what to look at; it never decides the check.

## Tools

| Tool | Does |
|---|---|
| `get_ci_summary` | Jobs, attempts, failing tests, the flagged concerns and the changed files |
| `read_log`, `read_diff`, `read_file` | Bounded reads (6,000 characters) of a job's logs, the diff (or one file of it), or a file at the head commit |
| `rerun_job` | Reruns a required workflow's failed jobs once, only if the repository allows it (`flaky.rerun`) |
| `assess` | Asks the decision runtime about one flagged concern, sending its exact evidence |
| `answer_input_request` | When a decision waits for a fact, lets PullUp answer it from the repository |
| `finish` | Ends the review |

## Guardrails (in code, not in the prompt)

- `assess` only takes concerns code flagged, once each. It sends the detector's evidence; the agent may add up to three quotes, and each must appear in the diff or a log or it is dropped.
- `answer_input_request` names the concern; PullUp computes the value from the repository (today `known_flaky`, from the known-flaky list). The agent cannot type a fact in.
- At most 12 steps and 4,000 output tokens per run.
- Hard failures are decided before the agent starts.
- Any concern the agent did not assess, or a loop that failed, becomes a failed assessment, which the rule sends to a person.

## Harnesses

| `AGENT_HARNESS` | Runs on |
|---|---|
| `ai-sdk` (default with `ANTHROPIC_API_KEY`) | The Vercel AI SDK tool loop, on `AGENT_MODEL` (a Haiku-class model by default) |
| `claude-agent` | The Claude Agent SDK, with PullUp's tools served as an in-process MCP server and no other tools |
| `agentrun` | The same Claude Agent SDK call, declared as a one-node [AgentRun](https://agentrun.ai) `Workflow` (`src/server/agent/agentrun.ts`) and run with `runWorkflow` instead of calling the SDK directly. Opt-in; see below. |
| `scripted` | No model: a fixed planner calls the same tools in order. Used in demo mode and whenever no agent key is set |

All four share the tools and guardrails above (`src/server/agent/tools.ts`). Two kinds of domain prompting stay apart: the agent prompt says how a reviewer investigates; the runtime's rubrics say how to judge each concern ([The decision package](decision-package.md)).

### The `agentrun` harness

`AGENT_HARNESS=agentrun` runs the agent as an [AgentRun](https://agentrun.ai) `Workflow`: one `agent` node declaring every tool above and an `out` contract, validated structurally (`runWorkflow` checks the document before running it) and run in-process with `@parcha/agentrun-dsl`'s `runWorkflow` — no separate server, no AgentRun console. `runNode` (`src/server/agent/agentrun.ts`) is PullUp's own function: it opens the same Claude Agent SDK session `claude-agent.ts` does, with the same tools and the same 12-turn cap, so behavior is meant to match `claude-agent` exactly.

This is deliberately a small first step, not a rewrite: `assess` stays one of the agent node's own tools (the agent decides when to assess each concern, interleaved with reading evidence, exactly as today), not a separate graph-level step. AskWithAI's own idempotency key (`pullup:<run>:<concern>`, set in `pipeline.ts`) already makes a repeated `assess` call safe to retry without double-billing, independent of which harness is running. Splitting "investigate" from "assess" into two graph phases — the natural next step, and the one that would let AgentRun's recovery journal resume a review mid-flight and route `assess` through `@askwithai/sdk/agentrun-effect`'s `askwithaiEffect` as a true effect node — is not done here; see `agentrun.ts`'s header comment.

**Not yet the default.** `agentrun` has not been run against a real model and a real AskWithAI instance in this environment (no credentials were available when it was built) — only against a faux `runNode` in `agentrun.test.ts`, which proves the workflow document and tool dispatch are correct but not that the live Claude Agent SDK conversation behaves identically to `claude-agent`. Before switching the default, run `pnpm demo:compare` with `AGENT_HARNESS=claude-agent` and `AGENT_HARNESS=agentrun` against the same synthetic PRs and confirm outcomes, cost and latency match.
