# PullUp — agent guide

An Eve-native dynamic-CI analyst on a deterministic core engine. All domain
logic lives in `@pullup/core`; the CLI (`@pullup/cli`) and the Eve `agent/`
surface are thin adapters over it.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install dependencies |
| `pnpm build` | Build the six `@pullup/*` packages (web builds via `pnpm web:build`) |
| `pnpm typecheck` | Typecheck packages + agent/evals/scripts |
| `pnpm -r test` | Package tests (core 65 · db 4 · github 3 · jev 4 · server 8) |
| `pnpm pullup <cmd>` | Run the CLI via tsx |
| `pnpm web:dev` | Dashboard: API :4174 + Vite :5174 (proxy `/api`) |
| `pnpm web` | Build packages + web, serve `web/dist` from the API |
| `pnpm eve:info` | Inspect the discovered agent surface |
| `pnpm eve:eval` | Offline evals (agent needs `ANTHROPIC_API_KEY`; `t.judge` uses eve's default `typesafe-ai/jev` evaluator via AI Gateway) |

## Structure

```
agent/      Eve agent — agent.ts, instructions.ts, channels/github.ts,
            lib/core.ts (store+config wiring), tools/ (5 thin wrappers)
evals/      Eve evals (recovery, congestion-comparison, smoke, jev/*)
fixtures/   deterministic fixtures (healthy, congested, calibration, jev)
packages/   @pullup/core · @pullup/db · @pullup/github · @pullup/jev · @pullup/server · @pullup/cli
web/        dashboard SPA (SolidJS + Tailwind v4, nikala-ui design system)
docs/       architecture · cost-model · analytics · jev
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

## Jev risk layer

- `@pullup/core` never calls the network: models plug in through the
  `SignalModel` port. Live Jev lives in `@pullup/jev`; the deterministic
  `SyntheticSignalModel` (in `@pullup/core/testing`) is the offline default.
- Safety invariants live in `packages/core/src/signals/invariants.test.ts`:
  mode off is byte-identical to `main` (baseline hashes pinned in the test), a
  policy hit always escalates, `m < 1` is never applied, the injection PR
  never gets the fast path, shadow equals off, and `w*` never shortens. If you
  intentionally change report output, update `MAIN_BASELINE` in the same
  commit and say why.
- Approval is **stubbed**: `LoggingReviewActuator` logs GitHub review calls
  to `review_actions` and sends nothing. Don't add a live actuator without an
  explicit decision.
- Question-set wording is a versioned contract: edit → bump `version`.
- Regenerate fixtures with `pnpm exec tsx scripts/generate-fixtures.ts`. It
  augments healthy/congested in place, so existing timestamps and reports stay
  stable. Use `--regenerate` to rebuild them.

## Web dashboard (`web/`, `packages/server`)

- The server is a thin JSON layer over the **same** core calls the CLI uses
  (`prepareJevRuntime`, `buildReport`, `planReviewActions`). Never compute
  decisions in the browser. The web app imports `@pullup/core` for **types
  only**, because core pulls in `node:fs`/`node:crypto`.
- GETs are side-effect free (cached signals only). Model calls, logged actions,
  and calibration are explicit POSTs. Nothing posts to GitHub.
- `web/src/components/ui/` holds owned copies of nikala-ui components (see its
  README for the upstream commit and local modifications). Kit rules: `splitProps`,
  semantic tokens only, `rounded-lg` max. Feature components are grouped by
  directory (`overview/`, `pulls/`, `charts/`, `shared/`, `layout/`).
- Dark only. Tokens live in `web/src/index.css`. Bands and recommendations
  share one colour/label map in `web/src/lib/meta.ts`.
- Read resources with `safeLatest()`: Solid rethrows an errored resource's
  error when `.latest` is read.

## Testing conventions

- Determinism is load-bearing: fixtures are seeded (byte-identical per seed),
  analytics take an explicit `now`, and the report recomputes identically.
- Recovery evals verify the agent's reported numbers match the engine's; they
  are offline (no `live` tag). Live GitHub/Jev paths are tagged `live`; the
  live Jev eval also `t.skip`s without `TYPESAFE_API_KEY`. Jev evals assert on
  `triage_pull` / `log_review_action` output deterministically, because the
  eve judge is itself Jev.
