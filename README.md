# PullUp

**Workflows for dynamic CI.** PullUp compiles a repo's own PR history into a
two-cost economics recommendation: how long a pull request should wait for
human review before shipping it (and fixing bugs later) is the cheaper move.

- **Deterministic core** — every number comes from `@pullup/core`, a plain TS
  library. No network, no LLM, no randomness in the math.
- **Two-cost model** — waiting cost `D(w)` vs shipping-before-review cost
  `E(w)`; the per-PR max-wait threshold `w*` is where the marginal curves cross
  (see `docs/cost-model.md`).
- **Offline-first** — synthetic fixtures exercise the whole pipeline with no
  GitHub access. A live GitHub adapter and an Eve bot channel are wired but
  inert without credentials.
- **Jev risk layer** (optional) — per-hunk typed risk signals from TypeSafe's
  Jev model behind a deterministic path policy, with asymmetric authority
  (signals only raise risk), shadow → calibrate → active rollout, and bot review
  actions (approve / request changes / defer to human) that are **logged, not
  sent**. See `docs/jev.md`.
- **Configurable gate** — per-repo Settings (presets, action mode
  Evaluation / Block only / Full, size limits, always-human categories, tiers,
  review focus, custom raise-only questions) with a what-if preview and
  versioned, loosen-confirmed saves. See `docs/configuration.md`.
- **Governed authority** (Agent Baseline) — what PullUp decides and what it
  may *send* are separate: each action becomes a task with an explicit
  allow / comment-only / deny, a signed 5-minute single-use permit, a GitHub
  token scoped to one repo and revoked after use, verification after sending,
  a stop switch and a hash-chained evidence record. See `docs/authority.md`.
- **GitHub check** (optional) — one "PullUp" check run per commit with the
  decision and line annotations for findings. Neutral in Evaluation; it can
  fail only when PullUp requests changes at Act and the owner opted in. See
  `docs/github.md`.
- **Inline finding comments** (optional) — located findings posted on the
  diff lines, never duplicated across pushes, and resolved by PullUp when a
  later push fixes them (only PullUp's own threads). Information only.
- **Evidence check** (optional) — a read-only Claude pass on strong
  risk-signal findings that quotes the changed lines behind them; PullUp
  re-checks every quote against the diff. Raise-only: a confirmed finding may
  request changes (`signalsCanRequestChanges: "verified"`), nothing it says can
  remove a finding or enable an approval. `pullup verify`, `@pullup/verify`.
- **Decision outcomes** — what humans did after each PullUp decision (asks
  approved unchanged, approvals overridden, change requests addressed) and
  learnings that suggest settings changes; never applied automatically. See
  `docs/outcomes.md`.
- **Preview before opening a pull request** — `pullup preview` runs the same
  decision on a local branch (nothing sent, nothing written to history) and
  says what keeps it off the fast path; `skills/pullup-preview` teaches coding
  agents to use it. See `docs/preview.md`.
- **The repo's own lint rules** (optional) — Markdown rule files in the
  Gallant linter's format (`.agents/gallant/`), read from the default branch
  and checked per changed file by the same decision model in a separate lane.
  A failing rule is a raise-only finding; `pullup lint` runs the same rules
  before a push. See `docs/lint.md`.
- **No auto-merge** — PullUp approves, requests changes or asks a human; it
  never merges or touches branch protection.

## Quickstart (offline, no credentials)

```bash
pnpm install
pnpm build

# Generate the bundled fixtures (healthy + congested)
pnpm exec tsx scripts/generate-fixtures.ts

# CLI: init config, ingest a fixture, print the report
node packages/cli/dist/index.js init
node packages/cli/dist/index.js fetch fixtures/healthy --fixture fixtures/healthy.json
node packages/cli/dist/index.js report fixtures/healthy
```

`report` prints the full markdown report: executive summary, two-cost
comparison, review latency, outcome buckets, defect proxies, congestion, and
per-open-PR decisions. `analyze` also writes `.md` + `.json` to an output dir.

```bash
node packages/cli/dist/index.js analyze fixtures/congested \
  --fixture fixtures/congested.json --out pullup-out
```

## Commands

| command | description |
|---|---|
| `init` | write `pullup.config.json` with default priors |
| `fetch <repoId> [--fixture <path>]` | ingest into SQLite (fixture = offline) |
| `analyze <repoId> [--fixture] [--out] [--jev-mode]` | write `.md` + `.json` report |
| `report <repoId> [--jev-mode]` | print the markdown report |
| `signals <repoId> [--model] [--record] [--pr] [--open-only]` | evaluate Jev risk signals (cached by content) |
| `verify <repoId> [--verifier claude\|synthetic] [--pr]` | check strong risk-signal findings against the code (cached by content) |
| `preview [--base] [--staged] [--ai] [--json] [--fail-on]` | what PullUp would do with the current branch (local git; sends nothing) |
| `outcomes <repoId> [--since] [--json]` | what humans did after PullUp's decisions, plus suggested learnings |
| `calibrate <repoId> [--model] [--out]` | fit + validate the risk model on labelled history; write the artifact |
| `actions <repoId> [--jev-mode] [--send]` | plan bot review actions; **log** them, or send to GitHub with `--send` / `PULLUP_GITHUB_DELIVERY=live` |
| `config [--config <path>]` | show resolved priors + provenance |

Jev flags: `--jev-mode off|shadow|active`, `--model jev|synthetic|replay`
(default: `jev` when `TYPESAFE_API_KEY` is set, else the deterministic
synthetic stand-in), `--replay <file>`, `--calibration <file>`.

```bash
# Offline Jev walkthrough on the scenario fixture (synthetic signal model)
node packages/cli/dist/index.js fetch fixtures/jev --fixture fixtures/jev.json
node packages/cli/dist/index.js report fixtures/jev --jev-mode shadow
node packages/cli/dist/index.js actions fixtures/jev --jev-mode active
node packages/cli/dist/index.js fetch fixtures/calibration --fixture fixtures/calibration.json
node packages/cli/dist/index.js calibrate fixtures/calibration
```

Live fetch and sending use a GitHub App (`GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY`)
or `GITHUB_TOKEN` (comments only). Setup, permissions and the approval gate are in
[`docs/github.md`](docs/github.md); enrolling repos, approving agent versions,
the stop switch and evidence are in [`docs/authority.md`](docs/authority.md).

## Web dashboard

A dark, local dashboard on the nikala-ui design system (SolidJS + Tailwind v4,
components copied into `web/src/components/ui/`). It shows the overview, PR queue
with per-PR cost curves and Jev signal breakdowns, logged review actions,
calibration gates, analytics, and settings.

```bash
pnpm web:dev      # API :4174 (tsx watch) + Vite :5174 with /api proxy
pnpm web          # build everything, then serve web/dist from the API on :4174
```

With nothing ingested, the home page offers the bundled fixtures (dev only).
The top bar's **Off / Shadow / Active** switch changes only the view
(`?mode=`), never config. The only mutations are **Run signals**, **Log review
actions** (logged, or sent to GitHub when `PULLUP_GITHUB_DELIVERY=live`),
and **Run calibration**. The API
binds to `127.0.0.1` and has **no auth**. It's a local tool, so don't expose it.
Env: `PULLUP_DB_PATH`, `PULLUP_API_PORT`, `PULLUP_NOW` (pin the clock for
demos and tests).

## The bot (Eve)

```bash
pnpm eve:info        # discover agent, tools, github channel
pnpm eve:eval        # offline evals (needs ANTHROPIC_API_KEY)
```

The Eve surface is intentionally thin: `agent/` holds instructions, the GitHub
channel (dispatch on PR opened/updated/mention, `turnPolicy: "queue"`), and
five tools (`ingest_repo`, `analyze_repo`, `two_cost`, `triage_pull`,
`log_review_action`) that call the core engine. `triage_pull` returns Jev bands,
the planned review action, and the flagged hunks; the agent writes the rationale
Jev can't, and `log_review_action` records it (the engine picks the action).
See `docs/architecture.md` and `docs/jev.md`.

## Structure

```
agent/      Eve surface: agent.ts, instructions.ts, channels/github.ts,
            tools/ (thin), lib/core.ts (store + config wiring)
packages/   @pullup/core (engine + Jev layer) · @pullup/db (SqliteStore) ·
            @pullup/github (fixture + octokit sources) · @pullup/jev (live
            Jev adapter) · @pullup/server (dashboard API) · @pullup/cli
web/        dashboard (Vite + SolidJS + Tailwind v4, nikala-ui components)
fixtures/   healthy · congested (+ synthetic hunks) · calibration (600 PRs) ·
            jev (scenario PRs #1001–#1005 covering every band)
evals/      offline evals (recovery, congestion, smoke, jev/*) + live-tagged Jev
docs/       architecture · cost-model · analytics · jev · lint · configuration · github · authority · outcomes · preview
skills/     pullup-preview (agent skill: run a preview before opening a pull request)
scripts/    generate-fixtures.ts
```

## Verify

```bash
pnpm typecheck
pnpm -r build
pnpm -r test      # 303 tests across core/db/github/jev/verify/cli/server
pnpm eve:info     # 0 errors, 5 authored tools, github channel at /eve/v1/github
```

## Configuration

`pullup.config.json` overrides any prior from `DEFAULT_PRIORS` (zod-validated;
unrecognized keys error). The `jev` key configures the risk layer (mode, pinned
model, thresholds, weights, calibration path, budget, human reviewers) and
`policy` overrides the path rules — defaults in `docs/jev.md`. Priors, their defaults, and the model math are in
`docs/cost-model.md`. See `.env.example` for environment variables.
