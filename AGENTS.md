# PullUp — agent guide

An Eve-native dynamic-CI analyst on a deterministic core engine. All domain
logic lives in `@pullup/core`; the CLI (`@pullup/cli`) and the Eve `agent/`
surface are thin adapters over it.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install dependencies |
| `pnpm build` | Build the four `@pullup/*` packages |
| `pnpm typecheck` | Typecheck packages + agent/evals/scripts |
| `pnpm -r test` | Package tests (core 25 · db 2 · github 2) |
| `pnpm pullup <cmd>` | Run the CLI via tsx |
| `pnpm eve:info` | Inspect the discovered agent surface |
| `pnpm eve:eval` | Offline evals (agent needs `ANTHROPIC_API_KEY`; `t.judge` uses eve's default `typesafe-ai/jev` evaluator via AI Gateway) |

## Structure

```
agent/      Eve agent — agent.ts, instructions.ts, channels/github.ts,
            lib/core.ts (store+config wiring), tools/ (3 thin wrappers)
evals/      Eve evals (recovery, congestion-comparison, smoke)
fixtures/   generated deterministic fixtures (healthy + congested)
packages/   @pullup/core · @pullup/db · @pullup/github · @pullup/cli
docs/       architecture · cost-model · analytics
```

## Working in `agent/`

- **Tools are thin wrappers** over `@pullup/core` (via `agent/lib/core.ts`).
  No logic or tests under `agent/tools/` — eve recursively discovers every file
  there and would try to evaluate tests as tools.
- **Eve identity is path-derived** — never add a `name`/`id` field to a
  `defineAgent`/`defineTool`/channel.
- **No logic or tests under `agent/tools/`** (discovery footgun — see above).
- **Channels stamp `turnPolicy` on the export** (`"queue"` for github): eve
  0.65 `githubChannel()` has no `turnPolicy` option, the runtime reads it off the export; webhook bursts must not cancel a
  committed analysis turn.
- **Direct Anthropic wiring** with explicit `modelContextWindowTokens`
  (200_000) — the direct provider id isn't in eve's gateway catalog.
- Root `vitest.config.ts` covers `agent/**/*.test.ts` only; each package owns
  its vitest config.
- The GitHub channel needs App credentials from env to dispatch (`GITHUB_APP_ID`,
  `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`). Missing creds in dev → channel
  present, webhooks inert (`eve info` still lists it).

## Drizzle

- Use `eq`/`and`/`desc` as functions inside `where(...)`, never as methods
  (`where(and(eq(a, b), eq(c, d)))`).
- `@libsql/client` and `drizzle-orm` are pinned at the **root** too — eve's
  module bundler resolves them from the app root, not the package tree.
  Keep the versions in lockstep across root + packages.

## Testing conventions

- Determinism is load-bearing: fixtures are seeded (byte-identical per seed),
  analytics take an explicit `now`, and the report recomputes identically.
- Recovery evals verify the agent's reported numbers match the engine's; they
  are offline (no `live` tag). Live GitHub paths are tagged `live` and excluded
  from the default `eve eval` run.
