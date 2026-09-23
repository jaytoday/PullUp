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
- **Skeleton build** — PullUp *reports* on dynamic-CI economics. Enforcement
  (auto-merge, gate changes) and review-agents are explicitly deferred.

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
| `analyze <repoId> [--fixture] [--out]` | write `.md` + `.json` report |
| `report <repoId>` | print the markdown report |
| `config [--config <path>]` | show resolved priors + provenance |

Live fetch uses `GITHUB_TOKEN` (a GitHub App installation token works too).

## The bot (Eve)

```bash
pnpm eve:info        # discover agent, tools, github channel
pnpm eve:eval        # offline evals (needs ANTHROPIC_API_KEY)
```

The Eve surface is intentionally thin: `agent/` holds instructions, the GitHub
channel (dispatch on PR opened/updated/mention, `turnPolicy: "queue"`), and
three tools (`ingest_repo`, `analyze_repo`, `two_cost`) that call the core
engine. See `docs/architecture.md`.

## Structure

```
agent/      Eve surface: agent.ts, instructions.ts, channels/github.ts,
            tools/ (thin), lib/core.ts (store + config wiring)
packages/   @pullup/core (engine) · @pullup/db (SqliteStore) ·
            @pullup/github (fixture + octokit sources) · @pullup/cli
fixtures/   healthy.json · congested.json (generated, deterministic)
evals/      offline evals (recovery, congestion comparison, smoke)
docs/       architecture · cost-model · analytics
scripts/    generate-fixtures.ts
```

## Verify

```bash
pnpm typecheck
pnpm -r build
pnpm -r test      # 29 tests across core/db/github
pnpm eve:info     # 0 errors, 3 tools, github channel at /eve/v1/github
```

## Configuration

`pullup.config.json` overrides any prior from `DEFAULT_PRIORS` (zod-validated;
unrecognized keys error). Priors, their defaults, and the model math are in
`docs/cost-model.md`. See `.env.example` for environment variables.
