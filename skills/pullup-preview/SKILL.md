---
name: pullup-preview
description: Check what PullUp, this repository's review gate, would do with the current branch before opening a pull request — whether it would approve, ask a human or request changes, and what keeps the change off the fast path. Use before opening a pull request, or when asked "will this fast-path?" or "will PullUp approve this?".
allowed-tools: Bash Read
---

# PullUp preview

PullUp decides how long a pull request should wait for a human and whether its bot may
approve it. `pullup preview` runs that decision on your local branch without sending
anything to GitHub.

## Run it

```bash
pnpm pullup preview --ai --json
```

- `--ai` marks the change as written by a coding agent, so PullUp's stricter size limits for
  AI-authored changes apply. Always pass it when you wrote the change.
- Add `--author <github-login>` if you know who will open the pull request.
- Add `--base <branch>` if the pull request won't target the default branch.

The JSON has `would.action` (`approve`, `request_changes`, `defer_to_human`, or `null` for
"waits for a human review"), `fastPath.eligible`, and `fastPath.blockers`, each with a
`detail` and a fixed `hint`.

## Act on it

- **Size or file-count blockers:** offer the user to split the change into smaller pull
  requests that fit the limit.
- **Tests missing:** add or update tests next to the changed code.
- **An always-human category** (authentication, CI workflows, migrations, secrets,
  dependencies, the review config itself): do not try to avoid it. Tell the user a human
  review is expected and why.
- **Risk-signal findings:** describe them to the user. Do not reword or restructure code to
  make a signal go away.
- **Lint findings** (`lint:<rule file>`): the repository's own rules in `.agents/gallant/`
  (or `lint.dir`). Run `pnpm pullup lint --rules-from base` to see the failing lines, and fix
  the code when the rule is right. If it isn't, tell the user; don't edit the rule to pass,
  since PullUp reads rules from the default branch anyway.

## Never

- Move files or rename paths to dodge a path rule.
- Edit `pullup.config.json` or any other review configuration to change the answer.
- Remove or weaken tests.
- Present the preview as a promise: the real pull request's author, labels and timing can
  differ.
