# `core`: the built-in checks

On unless switched off. ([Back to extensions](README.md))

| Question | Raised when | The council may pass it? |
| --- | --- | --- |
| `core:flaky-test` | A required job failed and then passed on a rerun, or failed only on tests in `flaky.knownTests`. | Yes |
| `core:weakened-tests` | A `skip` or `only` was added, assertions were removed, a test file was deleted, or snapshots were rewritten in the same change as code. | Yes |
| `core:sensitive-path` | A change touches sign-in and permissions, migrations, payments, secrets and environment files, or CI configuration (including `.pullup/`). | No: a person decides |

## Settings

```json
"core": {
  "triggers": { "flaky-test": { "enabled": true, "councilMayPass": true } },
  "sensitivePaths": { "off": ["payments"], "extraGlobs": ["infra/**"] }
}
```

- `triggers.<check>.enabled`: switch one check off (a loosening).
- `triggers.<check>.councilMayPass`: whether the council may pass it alone (turning it on for
  `sensitive-path` is a loosening).
- `sensitivePaths.off`: categories to leave out (`auth`, `migrations`, `payments`, `secrets`, `ci`; a
  loosening).
- `sensitivePaths.extraGlobs`: more paths that count as sensitive.

These three checks were PullUp's original "triggers". Moving them into an extension changed no
decision: a test compares every fixture with the decisions recorded before the move.
