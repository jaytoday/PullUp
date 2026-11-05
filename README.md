# PullUp

A continuous integration (CI) check for pull requests, built as an app on WithAI's public API.

Each run ends one of three ways:

1. **Hard failure → fail.** A required job failed and failed again on rerun. No AI is called.
2. **Nothing tricky → pass.** No extension raised a question. No AI is called.
3. **Something tricky → ask the council.** A few AI reviewers (WithAI "seats") answer typed
   questions. A fixed rule in code turns their answers into pass, fail, or "ask a person".

PullUp posts one GitHub check run called "PullUp". Every repository starts in **shadow mode**: the
check is neutral and says what PullUp would decide. In **active mode** it passes or fails, and a
question the council cannot settle goes to a person. How it works in detail: `docs/how-it-works.md`.

What PullUp looks for comes from **extensions** (`docs/extensions.md`): the built-in `core` checks
(flaky tests, weakened tests, sensitive paths), a `threat-model` check against the repository's
`THREATS.md`, `codeowners` to pick who to ask, and `doc-links` for reviewer links. Each one can be
Off, in Shadow mode (shown, never counted) or Active. PullUp's own threat model is
`docs/threat-model.md`.

## Layout

| Folder | What it is |
| --- | --- |
| `packages/sdk` | The extension interface and the shared types extensions read (the CI run, the parsed diff, path globs, questions). |
| `packages/extensions` | The bundled extensions, one folder each (`core`, `threat-model`, `codeowners`, `doc-links`). |
| `packages/engine` | Pure rules, no network: config, hard failures, the extension host, the council's answer checks, the resolution rule, asking a person and the no-answer options, permits, the evidence chain, the check run text. |
| `packages/github` | GitHub: App sign-in, webhook signatures, collecting a commit's CI results (jobs, reruns, logs, JUnit reports, the diff), and the governed sender (the only code that writes to GitHub). |
| `packages/withai-client` | A copy of WithAI's typed client. |
| `src/` | The Next.js app (port 3500): webhooks, the run pipeline, the dashboard, the landing page. |
| `worker/` | The worker as its own process (by default it runs inside the web server). |
| `cli/` | `pullup check`: decide a fixture or your current branch locally; `pullup extensions`. |
| `fixtures/` | Recorded CI runs for tests, and `fixtures/recorded/` with live council answers. |
| `e2e/` | Browser checks with Playwright. |

## Running it

Needs Node 24 and pnpm. Copy `.env.example` to `.env` and fill it in (see the comments there).

```bash
pnpm install
pnpm seed          # optional: a development database with 11 example runs and an owner account
pnpm dev           # http://localhost:3500
```

Sign in as `owner@example.com` / `pullup-dev-password` after `pnpm seed`, or create the owner account
on the sign-in page (the first account owns the instance; sign-up closes after it).

For GitHub, point the App's webhook (or a smee relay during development) at
`<PULLUP_URL>/api/github/webhook`. The App needs Checks (read and write), Actions (read and write),
Contents (read), Pull requests (read), Issues (read and write, for the reminder comment), and the
events Workflow run, Check run and Issue comment.

## Checking it

```bash
pnpm typecheck
pnpm test                    # engine, GitHub package, client, server and command line tests
pnpm build
pnpm pullup check --fixture fixtures/weakened-skip.json --replay fixtures/recorded/weakened-skip.json
node e2e/screens.mjs         # every page, light and dark, desktop and phone (needs `pnpm dev` and `pnpm seed`)
node e2e/effects.mjs         # every animated effect, with and without reduced motion
node e2e/setup.mjs           # the repo setup wizard, including presets and the confirmation for looser settings
node e2e/extensions.mjs      # Settings → Extensions, run page groups, the accuracy page's Shadow table
```

## Libraries with conditions

The animated components in `src/components/effects` include copies from React Bits, whose license
allows using them inside this app but not selling or redistributing the components themselves. See
`src/components/effects/README.md`.
