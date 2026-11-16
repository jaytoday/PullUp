# Running and testing

Back to the [overview](README.md).

## Locally

```bash
pnpm install
cp .env.example .env.local   # BETTER_AUTH_SECRET, PULLUP_PERMIT_KEY (openssl rand -hex 32); PULLUP_DEMO=1 for demo mode
pnpm dev                     # http://localhost:3500; the first account owns this PullUp
```

The worker (waiting runs, outcomes) runs inside the web server every minute, or alone with `pnpm worker` and `PULLUP_SEPARATE_WORKER=1`. The database is `.data/pullup.db` (migrations apply at start). After this rebuild, delete an older `.data/pullup.db`: its tables are from the previous design.

For AskWithAI, run its `pnpm dev` (port 3700) and follow the [runbook](adopting-askwithai.md). For the agent on a real model, set `ANTHROPIC_API_KEY` (and optionally `AGENT_MODEL`, `AGENT_HARNESS`); without it the scripted planner runs.

## A GitHub App

Permissions: Checks (read and write), Actions (read; write only if `flaky.rerun` is on), Contents (read), Pull requests (read), Issues (read, for `/pullup` comments), Metadata (read). Events: Workflow run, Check run, Issue comment, Pull request. Set `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and point the webhook at `/api/github/webhook`. Upload JUnit reports as a `pullup-reports` artifact so failing tests have names.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
ASKWITHAI_REPO=<AskWithAI checkout> pnpm test:e2e
```

- `pnpm test`: the engine (fixtures, hard failures, concerns, quotes, the fixed rule including a random-answer property test), the GitHub package, the providers against recorded responses, the agent's guardrails and the AI SDK loop on a mock model, and the whole pipeline on a fake GitHub and AskWithAI's faux server (`@askwithai/sdk/testing`). No network.
- `pnpm test:e2e`: starts a throwaway AskWithAI from `ASKWITHAI_REPO` (in-memory database, demo engines, port 3792) and PullUp in demo mode (port 3591), then walks parity → shadow → active → a review answered from the keyboard → the quality panel. Screenshots go to `test-results/screens/`.
- `pnpm lint`: no local paths, no `db.query`, no Radix, shadcn, Tailwind or animation libraries, and screens import only the engine's browser entry.
