# Outcomes

Back to the [overview](README.md). Code: `src/server/outcomes.ts`.

What really happened goes back to AskWithAI, so it can measure realized loss, fit calibration and learn from settled cases:

| Event | Outcome |
|---|---|
| A pull request merged and not reverted within 7 days | `safe` |
| A merged revert pull request ("Reverts owner/repo#123", GitHub's revert text) | `risky` for every decision on the original pull request |
| A person's GitHub answer on a decision with no AskWithAI review | their label |

A settled AskWithAI review already counts as a label there, so it is not reported twice. Every report has an idempotency key (`pullup:<source>:<run>:<concern>`). Only decisions with an AskWithAI decision id are reported.

## Without code

The package's `connectors:` entry lets AskWithAI take outcomes from GitHub directly: labeling a pull request `pullup:reverted` marks every decision for its head commit `risky` (PullUp uses the head commit as the trace id). Point a GitHub webhook for `pull_request` events at the connector's address shown on the runtime's Overview tab.

## In demo mode

**Report outcomes** (Demo controls, or step 4 of `pnpm demo`) reports the synthetic generator's ground truth for every decided synthetic run. These outcomes are synthetic and marked so.
