# PullUp — agent guide

An Eve-native dynamic-CI analyst on a deterministic core engine. All domain
logic lives in `@pullup/core`; the CLI (`@pullup/cli`) and the Eve `agent/`
surface are thin adapters over it.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install dependencies |
| `pnpm build` | Build the seven `@pullup/*` packages (web builds via `pnpm web:build`) |
| `pnpm typecheck` | Typecheck packages + agent/evals/scripts |
| `pnpm -r test` | Package tests (core 212 · db 11 · github 46 · jev 4 · verify 4 · cli 1 · server 25) |
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
packages/   @pullup/core · @pullup/db · @pullup/github · @pullup/jev · @pullup/verify · @pullup/server · @pullup/cli
web/        dashboard SPA (SolidJS + Tailwind v4, nikala-ui design system)
docs/       architecture · cost-model · analytics · jev · configuration · github · authority · outcomes · preview
skills/     pullup-preview — agent skill for coding agents
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
  present, webhooks inert (`eve info` still lists it). The same App creds drive
  live reads/writes (`createRepoOctokit`); `@octokit/*` is pinned at the root
  too, for the same bundler reason as drizzle.

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
- Delivery (`docs/github.md`): `LoggingReviewActuator` logs by default;
  `GitHubReviewActuator` sends only when the operator sets
  `PULLUP_GITHUB_DELIVERY=live` (env, never repo settings). Get actuators via
  `createReviewActuator`, and compute `approvalGate` (live delivery + this repo's
  passing fast-path gate) for every plan; never pass `approvalUnlocked: true`
  from anywhere else. Actuator tests use a fake `ReviewClient`, never the network.
- Question-set wording is a versioned contract: edit → bump `version`.
- Regenerate fixtures with `pnpm exec tsx scripts/generate-fixtures.ts`. It
  augments healthy/congested in place, so existing timestamps and reports stay
  stable. Use `--regenerate` to rebuild them.

## Authority layer (`docs/authority.md`, Agent Baseline)

- PullUp decides; the authorizer authorizes. `planReviewActions` is never
  changed by this layer. Every surface calls `governPlan` right after planning
  (`sign: true` only on the path that sends; GETs pass `sign: false`) and hands
  the result to an actuator built by `createReviewActuator` **with a `guard`**
  (permit key, this process's agent identity, current config hash). A live
  actuator without a guard refuses to start.
- Governance can only lower a level, never raise it (test in
  `authority/authority.test.ts`). Deny is the default for any missing input.
- Permits never leave the process: never persist them (`withoutPermit`), never
  return them from a tool or API. Tokens never leave `credentials.ts`.
- Enroll / approve / quarantine / resume are CLI-only. The dashboard may stop,
  never resume — don't add a resume route.
- Evidence is append-only: add rows with `appendEvidence`, never update or
  delete. New kinds go in `EVIDENCE_KINDS`.
- Editing `agent/agent.ts`, `agent/instructions.ts` or any tool changes the Eve
  agent's composition hash: the new version may only comment until
  `pnpm pullup agents approve <hash>`.
- Scenario tests: `packages/github/src/conformance.test.ts`, named after the
  control each one evidences. Shared fakes: `harness.test-util.ts`.

## Evidence verifier (`@pullup/verify`, core `verify/`)

- Core stays network-free: verifiers plug in through the `EvidenceVerifier`
  port; `SyntheticEvidenceVerifier` (in `@pullup/core/testing`) is the offline
  default. Live Claude verifier tests use a scripted fake client.
- Raise-only: a verdict is attached to a finding (`attachVerdicts`) and can
  only let it request changes under `signalsCanRequestChanges: "verified"`.
  Never let a verdict remove or re-level a finding (tests in `verify/verify.test.ts`).
- Every quote is re-checked in `acceptVerdict`; never show unaccepted evidence.
- Bump `VERIFIER_PROMPT_VERSION` on any prompt, tool or schema change (cache key).

## Outcomes and learnings (`docs/outcomes.md`, core `outcomes/`)

- Derived on read from stored data; no table. Keep it pure and deterministic.
- Learnings are suggestions only: nothing under `outcomes/` may write config
  (test in `outcomes/outcomes.test.ts`). Accepting one goes through the
  settings save flow. Thresholds change → bump `LEARNING_POLICY_VERSION`.
- The `<repo_history>` block is numbers and identifiers only.

## Preview (`docs/preview.md`, core `preview/`)

- Same core calls as a real pull request, on the overlay store; never write
  through it except signal answers. Synthetic pull number is 0.
- Hints come from the table in `preview/result.ts`, never a model.
- Git access stays in `packages/cli/src/git.ts` (execFile, no shell).
- Parity test: `preview/preview.test.ts` checks findings and guardrails match
  the real path for every fixture pull request.

## Configuration (`docs/configuration.md`)

- Layers: defaults < `pullup.config.json` < repo settings version (DB,
  append-only). Resolve per repo with `loadRepoConfig` / `withRepoLayer`, and
  pass `configReportOptions(cfg)` + `authority: cfg.authority` everywhere a
  report or plan is built — never `loadConfig` alone for a repo.
- `config/schema.ts` and the `@pullup/core/config-schema` entry are
  browser-safe: no `node:` imports there (hashing lives in `config/config.ts`).
- Every new config leaf gets a `config/fields.ts` entry with its `loosens`
  direction; the save diff and typed-confirm rule depend on it.
- Action authority changes only what is sent. `comment`/`off` must never emit
  APPROVE/REQUEST_CHANGES, and approve `act` stays clamped until `approvalGate`
  unlocks it (tests in `actions/authority.test.ts`).
- Free text (review focus, custom questions) goes through `screenFreeText` in
  the schema; custom questions are raise-only (review band at most).
- Severity mode: decisions built with guardrails carry `findings` (P0/P1/P2,
  rule vs signal) and `scope`; `planReviewActions` uses them instead of the
  legacy band logic. Signal findings never request changes unless opted in,
  never on an injection PR, and never count in Observe. Invariants live in
  `findings/severity.test.ts` (defaults reproduce legacy actions; partial-path
  rules never add approvals).

## Web dashboard (`web/`, `packages/server`)

- The server is a thin JSON layer over the **same** core calls the CLI uses
  (`prepareJevRuntime`, `buildReport`, `planReviewActions`). Never compute
  decisions in the browser. The web app imports `@pullup/core` for **types
  only**, because core pulls in `node:fs`/`node:crypto` — except the
  browser-safe `@pullup/core/config-schema` entry (schema, field registry,
  presets, screen), used to validate settings drafts exactly like the server.
- GETs are side-effect free (cached signals only). Model calls, logged actions,
  and calibration are explicit POSTs. Only POST `…/actions` can reach GitHub,
  and only with live delivery.
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
