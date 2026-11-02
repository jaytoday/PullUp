# Inert-change lint rule test

Checks whether the example lint rule `docs/examples/lint/flag-off-behavior.md`
can tell a change that is switched off behind a feature flag ("inert") from one
that changes behavior while every flag is off.

```bash
ANTHROPIC_API_KEY=... scripts/inert-lint-test/run.sh                 # model answers first
ANTHROPIC_API_KEY=... scripts/inert-lint-test/run.sh --reason-first  # model reasons first
scripts/inert-lint-test/run.sh --rule path/to/other-rule.md          # try a different rule text
```

- `make-repo.sh` builds a throwaway git repo (a small shop app) with one branch
  per case. Branches named `inert-*` should pass the rule; the others should fail it.
- `claude-systemone.mjs` is a stand-in System One server (`POST /v1/systemone`)
  that asks Claude for the probability of "yes". It is a test harness, not a
  replacement for Jev: Claude's stated probability is not calibrated the way Jev's is.
- `run.sh` runs `pullup lint --rules-from base` on every branch, prints expected
  against actual, each file's probability and the model's reason, and exits 1 on
  any wrong result. Each run costs a few cents.

To add a case, add a branch in `make-repo.sh`, named `inert-…` if it should pass.
