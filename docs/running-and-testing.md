# Running and testing

([Back to the overview](README.md))

## Running it locally

Needs Node 24 and pnpm. Copy `.env.example` to `.env` and fill it in; the comments there explain each
value (sign-in secret, permit key, GitHub App, AskWithAI runtimes, and temporary legacy human
notification settings).

```bash
pnpm install
pnpm seed          # optional: a development database with example runs and an owner account
pnpm dev           # http://localhost:3500
```

After `pnpm seed`, sign in as `owner@example.com` / `pullup-dev-password`.

Without `ASKWITHAI_API_KEY`, `PULLUP_REVIEW_RUNTIME`, and a positive `PULLUP_REVIEW_VERSION`, review calls fail closed to the existing
person-needed path. Without a separately configured `PULLUP_SCREEN_RUNTIME` and positive `PULLUP_SCREEN_VERSION`, screens come back
"not checked" and never imply a pass. AskWithAI key scopes and runtime labels are described in [The
AskWithAI connection](askwithai-connection.md). `WITHAI_URL` and `WITHAI_TOKEN` are only needed for the
temporary email, phone, or member notification path.

Two operator scripts: `pnpm tsx scripts/finish-run.ts <runId>` settles a run again and re-posts its check
(after fixing a refused check run); `pnpm tsx scripts/verify-chain.ts <owner/repo>` checks a repository's
evidence chain.

## Connecting GitHub

Point the GitHub App's webhook (or a smee relay during development) at `<PULLUP_URL>/api/github/webhook`.
The App needs these permissions: Checks (read and write), Actions (read and write), Contents (read),
Pull requests (read), Issues (read and write, for the reminder comment). It needs these events:
Workflow run, Check run and Issue comment.

## Trying a decision without GitHub

`pnpm pullup check` decides locally and prints each reviewer's answer, the quotes that checked out,
the screens, the extensions' notes, and the result:

- `--fixture fixtures/<name>.json`: a recorded CI run;
- `--base main [--jobs jobs.json]`: your current branch's diff against `main`, with the config (and
  extension files) from `main`;
- `--record answers.json` saves every answer; `--replay answers.json` reuses them
  with no call;
- `--only <extension>` runs one extension (repeat for more).

`pnpm pullup extensions` lists the extensions and their settings.

## Checks

```bash
pnpm typecheck
pnpm test                    # every package, the server and the command line
pnpm build
node e2e/screens.mjs         # every page, light and dark, desktop and phone (needs pnpm dev and pnpm seed)
node e2e/effects.mjs         # every animated effect, with and without reduced motion
node e2e/setup.mjs           # the setup page, presets and the "loosen" confirmation
node e2e/extensions.mjs      # Settings → Extensions, run page groups, the accuracy page
```

The browser checks read `PULLUP_E2E_URL` (default `http://localhost:3500`).

Next.js allows one `pnpm dev` per folder. To run the browser checks while another dev server is
running, use a `git worktree` copy with its own `.data` folder and port.
