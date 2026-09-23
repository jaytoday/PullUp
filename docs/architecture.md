# PullUp — architecture

PullUp is a dynamic-CI toolkit: it turns a repo's own PR history into a
two-cost economics recommendation — how long a pull request should wait for
human review before shipping it and fixing bugs later is cheaper.

The build is a **walking skeleton**: fully deterministic and offline. The core
engine is a plain TypeScript library; a thin Eve agent surface and a CLI
consume it.

## Layers

```
┌──────────  web/  (SolidJS dashboard)  ──────┐
│ overview · PR queue + detail · actions ·    │
│ calibration · analytics · settings          │
└────────────────────┬────────────────────────┘
                     │ /api (JSON, loopback)
┌──────────  packages/server  ────────────────┐
│ GET report/pull/actions/calibration ·       │
│ POST signals/actions/calibrate (no GitHub)  │
└────────────────────┬────────────────────────┘
┌──────────────  agent/  (Eve)  ──────────────┐
│ instructions.ts · agent.ts · channels/ ·    │
│ tools/ (thin wrappers, no logic) · lib/core │
└────────────────────┬────────────────────────┘
                     │ HTTP/process
┌──────────────  packages/cli  (commander)  ──┐
│ init · fetch · analyze · report · config    │
└────────────────────┬────────────────────────┘
          ┌──────────┼──────────┬──────────────┐
          ▼          │          ▼              ▼
  packages/github    │   packages/db     packages/jev
  PullSource:        │   SqliteStore     SignalModel: live Jev
  fixtures (offline) │   (libsql +       (@typesafe-ai/sdk) +
  octokit (live,     │    drizzle)       model factory +
   keeps patches)    │                   prepareJevRuntime
          └──────────┴──────────┬──────────────┘
                     ▼
           ┌──────────────────┐
           │  @pullup/core    │  ← all logic lives here (no fs/network)
           └──────────────────┘
```

The rule: **every number is computed deterministically in `@pullup/core`**. The
CLI, the agent tools, and the Eve surface are thin adapters that validate input
and format output. There is no business logic under `agent/tools/` (that's also
an Eve discovery footgun — see AGENTS.md).

## The core pipeline

1. **Source** (`ingest/source.ts`) — the `PullSource` seam: repository, pulls,
   reviews, review comments, defect events. `FixturePullSource` serves offline
   JSON; `OctokitPullSource` hits the live GitHub API (tagged *live* in evals).
2. **Ingest** (`ingest/pipeline.ts`) — deterministic classification per PR:
   change type (feature/bugfix/refactor/dependency/docs/other), area
   (api/core/db/ops), size bucket, review metrics (`reviewHours`,
   `totalReviewHours`, `reviewOutcome`, `hadFindings`). Idempotent upserts.
3. **Analytics** (`analytics/`) — latency percentiles, outcome buckets,
   defect-proxy rates, review efficacy (shrunk), congestion queue depth.
4. **Cost model** (`cost/`) — assemble per-repo parameters (Bayesian shrinkage
   toward priors), then the two-cost decision: per-PR max-wait `w*`.
5. **Report** (`report/`) — typed `PullupReport` + markdown/JSON renderers.

### Jev risk layer (optional; `docs/jev.md`)

6. **Hunks** (`signals/hunks.ts`) — unified-diff hunks per file, stored per
   pull (`replaceHunks`), content-hashed.
7. **Policy** (`policy/policy.ts`) — deterministic path globs → requiresHuman
   / allowlisted category. Authoritative.
8. **Signals** (`signals/`) — `SignalModel` port, question set `q-v1`,
   code-only unit state + token-budgeted chunking, content-addressed cache,
   budgeted runs (`runSignals`), record/replay.
9. **Aggregate** (`signals/aggregate.ts`) — features → risk → band →
   `P_defect` multiplier (≥ 1 only), fast-path eligibility (logged).
10. **Calibrate** (`signals/calibrate.ts`) — fit + out-of-fold metrics +
    backtest + promotion gates → integrity-hashed artifact.
11. **Decision overlay** (`cost/decision.ts`) — per-PR `P_defect`, `escalate`
    recommendation; shadow mode records the active outcome alongside.
12. **Review actions** (`actions/review.ts`) — decisions → GitHub PR review
    calls (approve / request changes / defer to human), applied by
    `LoggingReviewActuator` (logged, never sent).

## Storage

`@pullup/db` implements the `PullStore` seam from `@pullup/core` over SQLite
(libsql client + drizzle). Repositories, pulls, reviews, review comments, and
defect events all have composite primary keys; re-ingestion is an upsert. The
Jev layer adds `hunks` (replaced per pull), `signals` (content-addressed answer
cache), `signal_runs` (cost/coverage), and `review_actions` (logged bot
reviews).

## Offline / live split

- Default path: `fixtures/*.json` → `FixturePullSource` → SQLite → report.
- Live path: `OctokitPullSource` with a GitHub App token (`GITHUB_APP_ID` +
  `GITHUB_PRIVATE_KEY` or `GITHUB_INSTALLATION_TOKEN`). Defect proxies come from
  the issue timeline (cross-referenced revert/hotfix PRs).
- The Eve GitHub channel only dispatches with App credentials present; in dev
  it stays registered but webhooks are inert.

## Config

`pullup.config.json` (zod-validated) overrides `DEFAULT_PRIORS`; its `jev` and
`policy` keys configure the risk layer (`resolveJevConfig`, `resolvePolicy`)
and never leak into `CostPriors`. `resolvePriors`
merges `changeValueHoursByType` and `defectPriorByType` deeply; everything else
shallow. `loadConfig` returns provenance (which fields came from the file).
