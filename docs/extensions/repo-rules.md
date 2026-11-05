# `repo-rules`: the repository's own rules

([Back to extensions](README.md))

Rules are Markdown files in `.pullup/rules/` on the default branch, in the format of the Gallant linter,
so the same folder works for a developer running Gallant before pushing:

```md
---
appliesTo: "*.ts"
type: noul
minConfidence: 0.5
---
Does this file leave debugging code (console.log, debugger) behind?
```

- `appliesTo`: file-name patterns (`*.ts`). A pattern with a folder (`**/*.ts`) never matches in
  Gallant, so PullUp refuses it and says why.
- `type`: `noul` (yes/no; fails when "yes" is more likely than `minConfidence`), `choice` (named
  options) or `score` (levels), with `criteria` and a `violation` clause saying when it fails.
- PullUp-only: `pullupLevel` (`p1` / `p2`, a label) and `pullupCouncilMayPass: false` (a person decides
  this rule).

## How it checks

For each changed file a rule applies to, the host asks one [screen](screens.md). A rule that fails, with
a quoted line from the change, raises one question `repo-rules:<rule>` for the council, with the rule
text as context. A broken rule file is a note on every run until fixed.

A file that could not be checked becomes a question when `failClosed` is on (the default; switching it
off is a loosening). No rules folder is a note.

## Settings

`dir` (default `.pullup/rules`), `failClosed` (default `true`), `councilMayPass` (default `true`; a
rule can only make itself stricter).
