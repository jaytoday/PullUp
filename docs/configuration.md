# Configuration

Back to the [overview](README.md).

## `.pullup/config.json` (on the default branch)

```json
{
  "requiredWorkflows": ["ci"],
  "flaky": { "knownTests": ["checkout.spec.ts > shows confirmation"], "rerun": false },
  "concerns": { "flaky_retry": true, "deleted_tests": true, "sensitive_change": true },
  "sensitivePaths": { "off": [], "extraGlobs": ["src/billing/**"] },
  "reviewers": ["sam"]
}
```

| Field | Meaning |
|---|---|
| `requiredWorkflows` | Workflows that must finish; a required workflow that never ran fails the run |
| `flaky.knownTests` | Tests known to fail now and then (`file > name` from JUnit). A failure of only these is a concern, not a hard failure; also the source of the `known_flaky` fact |
| `flaky.rerun` | Allow the agent's one rerun of failed jobs (costs CI minutes) |
| `concerns` | Switch a concern off |
| `sensitivePaths` | Categories to leave out (`auth`, `migrations`, `payments`, `secrets`, `ci`) and extra globs |
| `reviewers` | GitHub logins whose buttons and `/pullup` comments count (admins always count) |

The check mode (Report only or Enforce) is set per repository on `/settings`.

## Environment

See `.env.example`. The groups: sign-in (`BETTER_AUTH_*`), PullUp (`PULLUP_URL`, `PULLUP_PERMIT_KEY`, `PULLUP_STOP`, `PULLUP_DEMO`), the GitHub App, the decision provider (`PULLUP_DECIDER`, `JEV_*`, `GEMINI_*`, `ASKWITHAI_URL`, `ASKWITHAI_API_KEY`, `PULLUP_RUNTIME`), the agent (`ANTHROPIC_API_KEY`, `AGENT_MODEL`, `AGENT_HARNESS`) and the database (`TURSO_*`). Keys live in `.env.local`, which git ignores.
