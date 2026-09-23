# PullUp — architecture

PullUp is a dynamic-CI toolkit: it turns a repo's own PR history into a
two-cost economics recommendation — how long a pull request should wait for
human review before shipping it and fixing bugs later is cheaper.

The build is a **walking skeleton**: fully deterministic and offline. The core
engine is a plain TypeScript library; a thin Eve agent surface and a CLI
consume it.

## Layers

```
┌──────────────  agent/  (Eve)  ──────────────┐
│ instructions.ts · agent.ts · channels/ ·    │
│ tools/ (thin wrappers, no logic) · lib/core │
└────────────────────┬────────────────────────┘
                     │ HTTP/process
┌──────────────  packages/cli  (commander)  ──┐
│ init · fetch · analyze · report · config    │
└────────────────────┬────────────────────────┘
          ┌──────────┴──────────┐
          ▼                     ▼
  packages/github         packages/db
  PullSource adapters:    SqliteStore
  fixtures.ts (offline)   (libsql + drizzle)
  octokit.ts (live)
          └──────────┬──────────┘
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

## Storage

`@pullup/db` implements the `PullStore` seam from `@pullup/core` over SQLite
(libsql client + drizzle). Repositories, pulls, reviews, review comments, and
defect events all have composite primary keys; re-ingestion is an upsert.

## Offline / live split

- Default path: `fixtures/*.json` → `FixturePullSource` → SQLite → report.
- Live path: `OctokitPullSource` with a GitHub App token (`GITHUB_APP_ID` +
  `GITHUB_PRIVATE_KEY` or `GITHUB_INSTALLATION_TOKEN`). Defect proxies come from
  the issue timeline (cross-referenced revert/hotfix PRs).
- The Eve GitHub channel only dispatches with App credentials present; in dev
  it stays registered but webhooks are inert.

## Config

`pullup.config.json` (zod-validated) overrides `DEFAULT_PRIORS`. `resolvePriors`
merges `changeValueHoursByType` and `defectPriorByType` deeply; everything else
shallow. `loadConfig` returns provenance (which fields came from the file).
