# Quick start

Back to the [overview](README.md). For GitHub App setup and the full automated checks, see [Running and testing](running-and-testing.md); this page is the shortest path to watching PullUp and AskWithAI decide something together on your own machine.

## 1. Get both apps running

You need two checkouts side by side: PullUp, and [AskWithAI](https://github.com/jaytoday/ask-with-ai) (the Decision Runtime Platform PullUp asks for judgment calls).

```bash
# In the AskWithAI checkout
pnpm install
pnpm dev                     # http://localhost:3700

# In this PullUp checkout, in another terminal
pnpm install
cp .env.example .env.local   # set BETTER_AUTH_SECRET and PULLUP_PERMIT_KEY: openssl rand -hex 32 for each
pnpm dev                     # http://localhost:3500; the first account you create owns this PullUp
```

Open `http://localhost:3500` and sign up. You now have a working PullUp with no GitHub App and no AskWithAI connection yet — that's normal, the next step wires AskWithAI in.

## 2. See AskWithAI answer a decision, with no credentials at all

The fastest way to watch the whole thing work — PullUp asking, AskWithAI answering, PullUp turning the answer into a check — needs no API keys, because demo mode uses synthetic data and AskWithAI's own faux decision engine:

```bash
pnpm test:e2e
```

This starts a throwaway AskWithAI (in-memory database, demo decision engines, port 3792) and PullUp in demo mode (port 3591), then walks through **parity → shadow → active**, answers a review from the keyboard, and opens the quality panel. Screenshots land in `test-results/screens/` — open them in order to see exactly what the browser saw at each step. If you'd rather click through it yourself instead of watching the automated version, set `PULLUP_DEMO=1` in `.env.local`, restart `pnpm dev`, and open `http://localhost:3500/runs` — demo mode seeds a few runs with concerns already flagged, ready to assess.

## 3. Connect your own AskWithAI runtime

Once you've seen it work end to end, follow [Adopting AskWithAI](adopting-askwithai.md) to point PullUp at a real runtime (`PULLUP_RUNTIME=<owner>/ci-review`) instead of the faux one, starting in **parity** mode (AskWithAI's answer is recorded but never used), then **shadow**, then **active**.

## 4. Try the agent with a real model

By default, with no `ANTHROPIC_API_KEY`, the agent runs on a fixed **scripted** planner (no model, deterministic — this is what demo mode always uses). To see the real tool-calling agent investigate a CI run:

```bash
# in .env.local
ANTHROPIC_API_KEY=sk-ant-...
AGENT_HARNESS=claude-agent     # or ai-sdk (the default once a key is set), or agentrun (opt-in, see below)
```

Restart `pnpm dev`, push a real pull request (or run `pnpm test:e2e` with the key set), and watch `/runs/[id]` — the agent's tool calls (`get_ci_summary`, `read_log`, `read_diff`, `assess`, ...) are listed in order, each with what it found.

`AGENT_HARNESS=agentrun` runs the identical Claude Agent SDK session through an [AgentRun](https://agentrun.ai) `Workflow` document instead of calling the SDK directly — see [The agent](the-agent.md#the-agentrun-harness) for what that changes (today: a validated workflow document; not yet: durable mid-review resumption). It has only been checked against a faux `runNode` in this environment, not a live model — try it, but compare its output against `claude-agent` on the same PR before trusting it in Active mode.

## If something doesn't work

- `pnpm test:e2e` failing at the first step almost always means AskWithAI's dev server isn't actually listening on port 3700/3792 yet — check its own terminal for errors first.
- "Set ASKWITHAI_URL, ASKWITHAI_API_KEY and PULLUP_RUNTIME" from `pnpm demo` means you skipped step 3 — demo mode's non-`test:e2e` path (`pnpm demo`) needs a real runtime configured, unlike `pnpm test:e2e`, which stands its own throwaway one up for you.
- A stale `.data/pullup.db` from before a schema change: delete it and let migrations recreate it (`pnpm dev` applies them on start).
