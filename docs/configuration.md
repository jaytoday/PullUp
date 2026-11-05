# Configuration

Each repository has one file, `.pullup/config.json`, on its **default branch**. PullUp never reads it
from a pull request, and never writes it: the dashboard's setup page and Settings build the file for
the owner to commit. ([Back to the overview](README.md))

Only `requiredWorkflows` and `ask.to` are required. Everything else has a safe default.

```json
{
  "requiredWorkflows": ["ci"],
  "flaky": { "knownTests": ["checkout.spec.ts > shows confirmation"], "rerun": false },
  "council": { "passStrength": 4, "needsPersonBlocksPass": true, "maxQuestionsPerRun": 6 },
  "screens": { "maxPerRun": 20 },
  "ask": {
    "to": "reviewer@example.com",
    "toGithub": "reviewer",
    "deadlineMinutes": 240,
    "onNoAnswer": "fail",
    "perExtension": { "core:flaky-test": "follow-council" }
  },
  "extensions": {
    "core": { "sensitivePaths": { "extraGlobs": ["infra/**"] } },
    "threat-model": { "mode": "shadow" }
  }
}
```

| Setting | What it does | Default |
| --- | --- | --- |
| `requiredWorkflows` | GitHub Actions workflows that must finish before PullUp decides. One that never runs fails the run. | (required) |
| `flaky.knownTests` | Tests known to fail now and then: a failure of only these is a question, not a hard failure. | `[]` |
| `flaky.rerun` | Rerun a failed required workflow once, so a flaky failure shows itself (costs CI minutes). | `false` |
| `council.seats` | The AI reviewers' viewpoints, one sentence each (1–6). | four viewpoints |
| `council.passStrength` | How sure (1–5) every reviewer must be for the council to pass a question. | `4` |
| `council.needsPersonBlocksPass` | One reviewer asking for a person stops a council pass. When `false`, a strict majority of strong passes is enough. | `true` |
| `council.maxQuestionsPerRun` | At most this many questions go to the council per run; the rest go straight to a person. | `6` |
| `screens.maxPerRun` | At most this many cheap model checks per run; the rest are "not checked". | `20` |
| `ask.*` | Who is asked and what happens with no answer. | see [Asking a person](asking-a-person.md) |
| `extensions` | One section per extension: its mode and its own settings. | `core` on, others off |

## Extension sections

Every section takes `mode` (`off`, `shadow` or `active`; a listed extension with no mode starts in
`shadow`), `maxQuestions` (default 3: more questions from it in one run are folded into one) and
`shadowCouncil` (default `true`: Shadow questions still go to the council so its answers can be
measured). The rest is the extension's own settings: see each extension's page under
[Extensions](extensions/README.md). `pnpm pullup extensions` lists them all with their defaults.

## Loosening

A setting that makes PullUp pass more easily (switching a check off, letting the council pass
something a person decides by default, passing on no answer…) is a **loosening**. The setup page and
Settings list every loosening and need "loosen" typed before they keep it.

## Older files

Files written before extensions keep working: top-level `triggers` and `sensitivePaths` are read as
`extensions.core`, and `ask.perTrigger` as `ask.perExtension` with `core:` in front of each key.
