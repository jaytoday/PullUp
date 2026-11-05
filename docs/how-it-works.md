# How PullUp works

PullUp is a check on pull requests. It reads the results of your continuous integration (CI) runs,
decides pass or fail, and asks for help only when a run needs judgment. Code decides; AI reviewers
advise; people set the rules and settle what the reviewers cannot; everything is recorded.

## One commit, start to finish

1. **A workflow finishes.** GitHub sends a signed `workflow_run` webhook. PullUp checks the signature,
   handles each delivery id once, and opens (or reopens, after a rerun) the run for that commit.
2. **Config.** PullUp reads `.pullup/config.json` from the repository's **default branch**, never from
   the pull request, so a pull request cannot loosen its own checks. No config → the run is an error
   and nothing is posted.
3. **Collect.** When every workflow in `requiredWorkflows` has finished, PullUp reads each job's
   attempts (a rerun is a second attempt), the end of each failed attempt's log, failing test names
   from JUnit files in a `pullup-reports` artifact if there is one, and the pull request's diff. A
   required workflow that has not finished after an hour is treated as missing.
4. **Optional rerun.** With `flaky.rerun` on, a required workflow whose jobs failed on the first
   attempt is rerun once, and PullUp waits for the new attempt.
5. **Hard failures.** A required job that failed every attempt, or failed once with a failing test that
   is not on the known-flaky list (or with no test name at all), or a required workflow that never ran,
   fails the run. No AI is called.
6. **Extensions.** Code looks for what needs judgment. Each enabled extension (see
   `docs/extensions.md`) may raise typed questions with evidence (exact diff lines or log text), named
   `<extension>:<key>`. The `core` extension, on by default, has three checks:
   - **flaky test:** a job failed and then passed on rerun, or failed only on known-flaky tests;
   - **weakened tests:** `skip`/`only` added, assertions removed, a test file deleted, or snapshots
     rewritten together with code;
   - **sensitive path:** a change under sign-in and permissions, migrations, payments, secrets or CI
     configuration (including `.pullup/`), plus any `sensitivePaths.extraGlobs`.
   Other extensions (the threat model, code owners, design doc links) are off unless the config lists
   them. Questions from an extension in Shadow mode are shown as "would ask" and never count.
   No question → the run passes. No AI is called.
7. **The council.** For each question, one WithAI `apply` call per seat (default four viewpoints: test
   reliability, security, maintainer of the touched area, release safety), in parallel, on WithAI's
   cheap tier, with the workspace's CI policy skill as guidance. Each seat answers
   `{ verdict: pass | fail | needs-person, strength: 1–5, reason, quotes }`. A call that fails, takes
   more than 60 seconds, hits WithAI's daily limit or returns the wrong shape counts as "needs-person".
8. **The quote check.** A quote counts only if it really appears in what it names: a changed line of the
   diff, a job log, or a report value. A "fail" without a quote that checks out counts as "needs-person".
9. **The resolution rule** (per question): any seat "fail" with a valid quote → the question fails. Every
   seat "pass" with strength at least `council.passStrength` (default 4), and the question allows a
   council pass → it passes. Otherwise → ask a person. Sensitive paths are never passed by the council
   unless the repository's config says so.
10. **The run:** any failed question → fail; any open question → waiting; otherwise pass.
11. **The check run.** One check called "PullUp" on the commit, sent through the governed sender (below).

## Shadow mode and active mode

Every repository starts in **shadow mode**: the check's conclusion is always neutral and its title
says "Shadow: would pass / fail / ask a person". No one is asked anything. The owner switches a
repository to **active mode** in Settings (typing the repository's name to confirm). Then the check
passes or fails, and a run that needs a person stays in progress, titled
"Waiting for <name>: <question>", with Pass and Fail buttons.

## Asking a person (active mode)

- **Who:** `ask.to` (an email address, a phone number in international format, or a WithAI member id),
  asked through WithAI, unless an extension names people for the question (the `codeowners`
  extension asks the owners of its files). `ask.toGithub` is that person's GitHub login, so their button presses and
  comments count as theirs.
- **Answering:** the WithAI message, the check run's Pass / Fail buttons, or a pull request comment
  starting with `/pullup pass <reason>` or `/pullup fail <reason>`. Only the people asked or a repository
  admin can answer. A button or comment answers every open question of the run. The first answer wins
  and the other WithAI questions are cancelled. If WithAI's webhook does not arrive, the worker finds
  the answer by asking WithAI every minute.
- **Waiting:** one reminder comment at half the deadline (`ask.remind`), then at `ask.deadlineMinutes`
  (default 240) the no-answer option: `ask.perExtension` for the question id (`core:flaky-test`), then
  for its extension (`threat-model`), then `ask.onNoAnswer`:

  | Option | At the deadline |
  | --- | --- |
  | `fail` (default) | The question fails: "No answer from <name>." |
  | `follow-council` | Pass if most seats said pass and no fail held up, otherwise fail. A question only a person may pass always fails. |
  | `pass` | The question passes: "Passed without an answer." |
  | `escalate` | Ask `ask.backup` with a fresh deadline; if that also goes unanswered, `ask.onNoAnswerAfterBackup`. |

  An answer that arrives after the deadline still counts and replaces the no-answer outcome. WithAI
  keeps the question open for a week past the deadline for this.
- **Learning:** each question is linked to the CI policy skill with the run as its `case`, so answers
  come back as that skill's labels in WithAI (the skill owner's answers at once, others' once the owner
  endorses them).

## Sending to GitHub: the governed sender

All writes go through `packages/github/src/send.ts`: the "PullUp" check run, the reminder comment,
and the optional rerun. For each one: the stop switch (Settings, or `PULLUP_STOP=1`) → a single-use
permit, signed with `PULLUP_PERMIT_KEY`, naming the exact call by its hash → the permit re-checked right
before acting (signature, expiry after five minutes, the same call, not used before) → the call →
the evidence record. A refusal or a failed call is recorded too. PullUp never merges, changes branch
protection or reverts anything.

## The evidence record

Each repository has an append-only chain of entries: collected, decided, permit issued, sent,
blocked, asked, answered. Each entry stores the hash of the one before it, so an edited or deleted
entry shows up; the run page says whether the chain is intact.

## The config file

`.pullup/config.json` on the default branch. Only `requiredWorkflows` and `ask.to` are required; the
setup page in the dashboard builds the file and asks for confirmation when a setting is looser than
the defaults. Each extension has its own section under `extensions` (see `docs/extensions.md`).

```json
{
  "requiredWorkflows": ["ci"],
  "flaky": { "knownTests": ["checkout.spec.ts > shows confirmation"], "rerun": false },
  "council": { "passStrength": 4, "needsPersonBlocksPass": true, "maxQuestionsPerRun": 6 },
  "ask": {
    "to": "reviewer@example.com",
    "toGithub": "reviewer",
    "deadlineMinutes": 240,
    "onNoAnswer": "fail",
    "perExtension": { "core:flaky-test": "follow-council" }
  },
  "extensions": {
    "core": { "triggers": { "sensitive-path": { "councilMayPass": false } }, "sensitivePaths": { "extraGlobs": ["infra/**"] } },
    "threat-model": { "mode": "shadow" }
  }
}
```

Older files with top-level `triggers`, `sensitivePaths` and `ask.perTrigger` still work.

## Trying a decision locally

`pnpm pullup check` decides without GitHub and prints each seat's answer, the quotes that checked
out, and the result:

- `--fixture fixtures/<name>.json`: a recorded CI run;
- `--base main [--jobs jobs.json]`: the current branch's diff against `main`, with the config from
  `main` (without `--jobs`, the required workflows are assumed to have passed);
- `--record answers.json` calls WithAI and saves its answers; `--replay answers.json` reuses them with
  no call;
- `--only <extension>` runs one extension (repeat for more).

`pnpm pullup extensions` lists the bundled extensions and their settings.
