# Code layout

Back to the [overview](README.md).

| Path | What is there |
|---|---|
| `packages/engine` | Pure code, no network or database: CI types (`ci.ts`), the diff parser, sensitive paths, the config, hard failures, the three concern detectors (`concerns.ts`), the assess input, the quote check (`quotes.ts`), the fixed rule (`policy.ts`), the check run text, permits and the tamper-evident record. `browser.ts` is the part screens may import. |
| `packages/github` | GitHub: App authentication, webhook signatures, collecting a commit's CI (`collect.ts`), the governed sender (`send.ts`), and a fake GitHub for tests and demo mode (`fake.ts`). |
| `src/server/pipeline.ts` | One run from collection to the check, waiting runs, GitHub answers |
| `src/server/agent/` | The agent: tools and guardrails (`tools.ts`), the AI SDK loop, the Claude Agent SDK loop, the scripted planner, `prompt.md` |
| `src/server/decide/` | The decision step: Jev, Gemini Decisions and AskWithAI providers |
| `src/server/outcomes.ts` | Merges, reverts and person answers reported to AskWithAI |
| `src/server/demo.ts`, `demo-github.ts` | Demo mode: synthetic pull requests through the real pipeline on the fake GitHub |
| `src/app/`, `src/components/` | Screens (Astryx, Cyanotype, AskWithAI's web kit) and routes: the GitHub webhook, the kit's route, the demo controls |
| `src/lib/db/` | The database (SQLite through libsql; Turso in production) and its schema; migrations in `drizzle/` |
| `askwithai/` | The decision package ([details](decision-package.md)) |
| `scripts/` | `generate-data.ts`, `demo.ts`, `demo-compare.ts`, `parity.ts`, `askwithai-sync.sh`, `lint.mjs` |
| `data/synthetic/` | Synthetic pull requests for demo mode |
| `fixtures/` | Recorded CI runs and diffs with the concerns each should raise |
| `vendor/` | AskWithAI's private web kit as a packed tarball (the SDK comes from npm) |
| `e2e/` | The browser test and the helpers that start a throwaway AskWithAI and PullUp |
| `worker/` | The worker as its own process (`pnpm worker`) |
