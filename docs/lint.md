# PullUp — lint rules (the repo's own checks)

A repo can keep its own review rules as Markdown files, in the format the
[Gallant](https://github.com/madxmike/gallant) linter uses. PullUp asks the
same decision model it uses for risk signals (Jev, or any System One server)
whether each changed file breaks each rule that applies to it, and reports a
failing rule as a finding. The same files work locally before a push, with
`pullup lint` or with Gallant itself.

Lint rules are for fuzzy, repo-specific rules that ordinary linters can't
express: "no debugging prints left in", "comments explain intent instead of
restating the code", "user-facing text follows our style guide".

## Turning it on

```json
"lint": { "mode": "on", "dir": ".agents/gallant", "level": "p2", "budgetUsdPerRun": 0.5 }
```

| field | meaning |
|---|---|
| `mode` | `off` (default) · `observe` (findings shown, never acted on) · `on` (findings count like other risk-signal findings) |
| `dir` | Rules folder inside the repo. Gallant's default is `.agents/gallant`. |
| `level` | Level of a failing rule that doesn't set its own: `p2` (a note, the default) or `p1`. |
| `budgetUsdPerRun` | Hard stop on one run's lint spend; files left over are not checked. |

Repo settings → **Lint rules** has the same fields and lists the rules PullUp
holds for the repo, with the reason for any file it couldn't use.

## Rule format

A rule is a Markdown file: frontmatter between two `---` lines, then the rule
text, which is sent to the model as written.

```markdown
---
appliesTo: "*.go"
type: noul
minConfidence: 0.8
pullupLevel: p1
---
Does this file violate the following rule?

# No debugging leftovers

A change should not carry debugging scaffolding: a print added to trace a
value, or commented-out code kept in case it is needed.
```

| field | meaning |
|---|---|
| `appliesTo` | A glob, or a list of globs, matched against the **file name**, not its folder (Gallant's rule). A rule without one never runs. |
| `type` | `noul` (yes/no: "yes" is a violation), `choice` (pick one option) or `score` (pick a level). |
| `criteria` | `choice`: options mapped to descriptions. `score`: levels, lowest first (2 to 10). |
| `violation` | `choice` / `score` only: `if` results that fail the rule above a probability, `unless` results that cancel it. A choice or score rule without one can never fail, so PullUp doesn't ask it. |
| `minConfidence` | `noul` only: the probability of "yes" above which the rule fails (default 0.5). |
| `pullupLevel` | PullUp only (Gallant ignores it): `p1` or `p2`. |

PullUp rejects exactly what Gallant rejects (missing or unclosed frontmatter,
an unknown type, a malformed glob, a threshold outside 0 to 1, a `violation`
naming an unknown result, and so on) and lists the reason. It also rejects a
file with invisible or bidirectional-control characters, a rule text over
8,000 characters, and `pullupLevel: p0`. Hidden files and folders and
non-Markdown files are skipped. At most 50 rules run, in path order.

## Where rules are read from

- **On GitHub:** from the repository's **default branch**, at the commit it
  points to, when the repo is ingested with lint on (`pullup fetch`, the
  agent's ingest, a webhook refresh). Never from the pull request: a pull
  request can't change the rules it is checked against, and a new rule only
  applies once it is merged. A missing folder clears the stored rules; a
  failed read keeps the last ones.
- **Without GitHub credentials:** `pullup lint-rules <repo> --from-ref origin/main`
  (from git in the current checkout) or `--from-dir <folder>`.
- **Preview:** `pullup preview` reads the rules at `--base`, the way PullUp
  will on the pull request.
- **Local lint:** `pullup lint` reads your working copy by default
  (`--rules-from base` to match the pull request).

`pullup lint-rules <repo>` shows what PullUp holds: the source, the commit,
each rule, and every file it couldn't use.

## How a run works

1. **One unit per changed file.** A file's hunks are joined in order and sent
   together, with only the rules whose `appliesTo` matches the file name.
   Files no rule applies to cost nothing. A file too large for the model's
   input is split at hunk boundaries (and one huge hunk on lines); a binary
   file or one GitHub returned without a patch is not checked.
2. **One call per unit** asks every applicable rule at once, under ids made of
   letters, digits and underscore.
3. **Answers are cached by content** (model, the rules asked, the file's
   changes), in the same cache as risk signals. A re-push re-asks only changed
   files; editing one rule re-asks only the files it applies to.
4. **Judging is Gallant's**: a `noul` fails when "yes" is strictly above
   `minConfidence`; a `choice` or `score` fails when some `if` result is
   strictly above its threshold and no `unless` result is above its own.

Runs happen with the risk signals (`pullup signals`, report commands, the
dashboard's "Run signals", the agent), whatever the risk-signal mode. Building
a report never calls a model: it reads cached answers.

## What a failing rule does

A failing rule becomes a finding `lint:<path>` on the pull request: title from
the file name (`leftover-debugging.md` → "Lint: Leftover debugging"), detail with the deciding
result and the hunks, for example `yes 0.93 > 0.5 · src/main.go#0`.

- **Raise-only.** A lint finding is a P2 note by default and P1 at most. Like
  every model-based finding, it can't request changes unless the repo sets
  `severity.signalsCanRequestChanges`. At P1 the default action is to ask a
  human; at P2 it only appears in PullUp's comment.
- **A separate lane.** Lint answers never enter the risk score, the fast path,
  the risk question-set version or the calibration, so editing a rule never
  invalidates the calibration artifact.
- **Observe** shows the findings in the dashboard and preview without acting
  on them.
- **Inline comments** (`inline.enabled`): a lint finding is posted on the first
  hunk of the file, with the others under "Also flagged". Set `inline.reportOn`
  to `p2` to get comments for P2 rules. PullUp resolves its own lint comment
  only when the lint lane fully checked that file at the new head (or the file
  left the pull request); the risk lane's comments are never resolved by a lint
  run, and the reverse.
- **No rule text reaches GitHub.** Comments name the rule file and quote the
  deciding result, never the rule's body.

## Before a push: `pullup lint`

```bash
pnpm pullup lint                   # base...HEAD, rules from your working copy; exit 1 if a rule fails, 2 if a file couldn't be checked
pnpm pullup lint --staged          # only staged changes
pnpm pullup lint --rules-from base # rules as the base branch has them (what the pull request gets)
pnpm pullup lint --json            # for scripts and coding agents
pnpm pullup lint --no-fail         # report only
```

It prints each failing rule with the file and new-side line ranges. When the
model can't check some file (server down, error) and no rule failed, it exits 2:
an unchecked change never counts as a pass. When a
PullUp database is present (`pullup.db`, or `--db`), answers go through the
same cache, so the pull request later reuses them. It never creates a
database.

Gallant itself reads the same folder:

```bash
git diff origin/main...HEAD | gallant --provider opencode --model jev-1.13 --rules .agents/gallant --diff
```

## Example rule: is the change switched off behind a feature flag?

`docs/examples/lint/flag-off-behavior.md` asks, for each changed file, whether
anything that runs or can be observed differs with every feature flag off. A
pull request whose new behavior sits entirely behind a flag that defaults to
off should pass it. Copy it into `.agents/gallant/` and adjust the line naming
how your code reads flags.

`scripts/inert-lint-test/run.sh` checks the rule against eight labeled
branches of a small test repo (three inert, five not: a shared function changed
outside the flag, an inverted flag check, a side effect at startup, data
written regardless of the flag, a flag default turned on). It runs PullUp's real
`pullup lint` against a stand-in System One server backed by Claude
(`ANTHROPIC_API_KEY`), and exits 1 if any branch gets the wrong result.

Result on 2026-11-01 (claude-sonnet-5, four runs each, same every run): 8 of 8
when the model writes its reasoning before the probability (`--reason-first`),
7 of 8 when it answers first. The miss is the inverted check
(`if (!isEnabled("skipOrderAudit")) insert(...)`): new code that runs while the
flag is off. A model that answers without reasoning, as Jev does, can miss it,
so this rule is a helper, not proof that a change is inert.

## Models

Lint uses the same model as risk signals (`docs/jev.md`): Jev on TypeSafe
with `TYPESAFE_API_KEY`, any System One server with `PULLUP_SYSTEMONE_URL`,
or the deterministic synthetic stand-in. The stand-in fails a rule when a
snippet the rule quotes in backticks (such as `` `fmt.Println` ``) appears on an
added line; for a choice it picks the last option and for a score the top
level (Gallant's examples list the bad outcome last).

## Limits

- Per-file checking can't see a problem that spans files.
- Decision models have small inputs. Long rules leave less room for the code,
  and very large files are split.
- Rules come from the default branch only. A pull request that targets
  another branch is still checked against the default branch's rules.
