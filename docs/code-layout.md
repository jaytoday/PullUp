# Code layout

How the code is organised, and how the parts call each other. ([Back to the overview](README.md))

```
GitHub ──webhook──▶ src/ (Next.js app: webhook routes, pipeline, worker, dashboard)
                      │ collects with packages/github
                      │ decides with packages/engine ──runs──▶ packages/extensions (each built on packages/sdk)
                      │ asks AI and people through packages/withai-client
                      └ sends to GitHub only through packages/github/src/send.ts
```

| Folder | What it is |
| --- | --- |
| `packages/sdk` | The extension interface, and the shared types extensions read: the CI run, the parsed diff, path patterns, questions, screens. No network, no clock. |
| `packages/extensions` | The bundled extensions, one folder each, plus `registry.ts` (the list). Each may import only the SDK, `zod` and its own files (a test checks this). |
| `packages/engine` | The rules, with no network or database: config, hard failures, the extension **host** (`host.ts`), screens, the council's answer checks, the resolution rule, asking a person and the no-answer options, permits, the record, the check's text. |
| `packages/github` | GitHub: App sign-in, webhook signatures, collecting a commit's CI results and files, and the governed sender (the only code that writes to GitHub). |
| `packages/withai-client` | A copy of WithAI's typed client. |
| `src/` | The Next.js app: webhook routes, the run pipeline (`src/server/pipeline.ts`), asking people, the worker loop, the dashboard pages, the landing page. |
| `worker/` | The worker as its own process (by default it runs inside the web server). |
| `cli/` | `pullup check` (decide a fixture or your branch locally) and `pullup extensions`. |
| `fixtures/` | Recorded CI runs for tests; `fixtures/recorded/` holds live AI answers to replay; `fixtures/golden/` holds decisions from before extensions, which must not change. |
| `e2e/` | Browser checks with Playwright. |
| `drizzle/` | Database migrations (SQLite, or Turso when configured). |

## The engine's main functions

- `decideRun` (`resolution.ts`): hard failures → screens → extensions → council → resolution rule.
- `runExtensions` and `planScreens` (`host.ts`): run every switched-on extension in order and enforce
  the extension rules.
- `startAsk`, `tick`, `answer` (`no-answer.ts`): asking a person, with time passed in.
- `checkRunView` (`check-run.ts`): the text of the PullUp check.
