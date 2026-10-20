# PullUp — preview before opening a pull request

`pullup preview` answers "what would PullUp do with my branch?" before a pull
request exists. It reads git locally and sends nothing to GitHub.

```bash
pnpm pullup preview                    # main...HEAD (base: origin's default branch)
pnpm pullup preview --staged           # staged changes
pnpm pullup preview --ai --json        # for coding agents (versioned JSON)
pnpm pullup preview --fail-on human    # exit 1 if a human would be asked (pre-push hook)
```

## How it works

- **Diff:** `git diff base...head` (three dots: only the branch's own changes,
  like a pull request), split per file into GitHub-style patches.
- **Same core calls:** the branch becomes a synthetic pull request number 0
  and goes through ingest, signals, guardrails, scoped rules, findings, the
  two-cost decision and `planReviewActions` — the code path a real pull
  request takes (`preview/run.ts`).
- **No writes to history:** everything runs on an overlay store
  (`preview/overlay-store.ts`): reads go through to the real store, writes
  stay in memory. The one exception is signal answers, a content-addressed
  cache, so the real pull request reuses them later.
- **Author:** `--author`, else `PULLUP_PREVIEW_AUTHOR`, else unknown. An
  unknown author is not treated as a first-time contributor, and the output
  says so.
- **Hints** for each blocker come from a fixed table in code, never a model.
- Exit code 0 on success (`--fail-on human|changes` to gate a hook).

## Agent skill

`skills/pullup-preview/SKILL.md` tells coding agents to run
`pullup preview --ai --json` before opening a pull request, to split
oversized changes and add missing tests, and never to dodge path rules, edit
review config or reword code to avoid a signal.

## Limits

- "Costs more than it's worth" and the wait time depend on how long a pull
  request has waited; a preview has waited 0 hours.
- The real pull request's author, labels and timing can differ, so the
  output says "a preview, not a promise".
