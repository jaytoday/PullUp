# The decision package

Back to the [overview](README.md). Folder: `askwithai/`.

PullUp's domain knowledge lives in its repository as an AskWithAI decision package, reviewed like code:

| File | Contents |
|---|---|
| `runtime.yaml` | The input schema, the question `merge_risk` (`risky` or `safe`), mistake costs, tiers, the review deadline, input fields, privacy, spend limits and the revert connector |
| `rubrics/fast.md` | A short checklist per concern for the fast decision model |
| `rubrics/reasoning.md` | A senior reviewer's rules per concern for the reasoning model |
| `tests/cases.jsonl` | 370 synthetic labeled cases from `pnpm generate-data` (splits: tune, holdout, hard) |

## Mistake costs

Answering `safe` when the truth is `risky` costs `25 + 2 × blastRadius` dollars (a bad merge, worse for bigger sensitive changes). Answering `risky` when it is `safe` costs $4 (a developer's time). Plain numbers the owner can edit.

## Tiers

Fast (Jev), reasoning (`gemini-3.1-pro-preview`), and a person (the repository's reviewers, a 4-hour deadline; on timeout the answer falls back to `risky`, which PullUp keeps waiting for a person). AskWithAI escalates when the expected cost of a mistake is larger than the price of asking.

## Pushing it

```bash
npx askwithai push askwithai --runtime <owner>/ci-review
npx askwithai check askwithai --runtime <owner>/ci-review
```

The same package is AskWithAI's `ci-review` studio template ("Use template" creates the runtime with these cases; "Evaluate" benchmarks it). After changing it, copy the folder to AskWithAI's `templates/ci-review/`.
