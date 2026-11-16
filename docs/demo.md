# Demo mode

Back to the [overview](README.md). Code: `src/server/demo.ts`, `scripts/`.

With `PULLUP_DEMO=1`, PullUp runs on a fake GitHub client and plays **synthetic** pull requests through the real pipeline, so every screen fills without a GitHub App or model keys. The agent is the scripted planner. Everything is marked synthetic or simulated.

## The data

`pnpm generate-data` writes (seeded, so the same every time):

- `data/synthetic/pulls.jsonl`: 360 pull requests with CI attempts, logs and diffs;
- `askwithai/tests/cases.jsonl`: 370 labeled concern cases in the runtime's input format.

The patterns: flaky retries that are the test environment (safe) or a real race (risky); tests deleted with their feature (safe) or loosened next to a behavior change (risky); sensitive changes that only log or add an index (safe) or lengthen a session, remove a permission check or drop a column (risky). About 70% are safe. The 51 "hard" cases are worded to mislead. The script stops if the detectors do not find exactly the labeled concerns.

## `pnpm demo`

Needs a local AskWithAI and `ASKWITHAI_URL`, `ASKWITHAI_API_KEY`, `PULLUP_RUNTIME` in `.env.local` ([runbook](adopting-askwithai.md)). It creates the runtime from the `ci-review` template in parity mode, plays a batch through PullUp's Jev client pointed at AskWithAI, switches to shadow and plays another, reports synthetic outcomes, switches to active and plays more through the SDK (some go to `/reviews`), then pushes a rubric change, replays it and promotes it if the release gates pass. `--fresh` clears earlier demo runs first.

The **Demo controls** on `/quality` do the same steps with buttons: play 10 pull requests, report outcomes, start over.

## `pnpm demo:compare`

Runs the holdout and hard splits (at most 200 cases each) through three configurations and writes [results](results.md): the decision model alone, a reasoning model on everything, and AskWithAI routing (person tier off, for a fair comparison). On demo engines the page carries the banner "Simulated engines. Shows how the system behaves, not how good real models are." A live run (real keys, capped) is labeled "measured on synthetic data".

## `pnpm parity`

Live only: sends up to 50 cases to Jev directly twice and once through AskWithAI, and reports agreement and added latency. The automated parity check, with recorded responses, is `src/server/decide/decide.test.ts`.
