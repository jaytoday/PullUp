# PullUp — the Jev risk layer

Jev (TypeSafe AI) is a non-generative "System One" model: it answers typed
questions (yes/no, pick-one, 1–N score) about a block of state in one parallel
pass, in ~100 ms, for ~$0.04 per million input tokens. It returns calibrated-ish
**probabilities, never reasons**. That makes it cheap enough to ask a dozen
atomic risk questions about **every hunk of every PR** — and unsuitable as the
final judge on its own. PullUp uses it as a **triage and risk-signal layer**
inside a larger gate.

```
 PR hunks ─► 1. deterministic policy ──── requiresHuman ──────────────► escalate
             (path globs, lockfiles)                                     (authoritative)
                     │
                     ▼
             2. Jev signals per hunk (SignalModel port — one call, all questions)
                     │
                     ▼
             3. aggregate in code: features → risk → band → P_defect multiplier m ≥ 1
                     │
                     ▼
             4. two-cost model (TCM) with per-PR P_defect → recommendation
                     │
                     ▼
             5. bot review action: approve / request_changes / defer_to_human
                (LoggingReviewActuator — logged, never sent)
```

## Modes

| mode | effect |
|---|---|
| `off` (default) | Layer skipped. Report is **byte-identical** to a build without it (tested against hashes captured on `main`). |
| `shadow` | Signals computed and shown; recommendations unchanged. Each decision records the `active →` recommendation and `w*` for comparison. |
| `active` | Policy hits and escalating signals produce `escalate`. The risk multiplier moves `P_defect` **only** with a passing calibration artifact; otherwise `m = 1`. |

Set via `pullup.config.json` → `jev.mode`, or `--jev-mode` on `report` /
`analyze` / `actions`.

## Question set `q-v1`

Asked **per hunk** in one call (`signals/questions/v1.ts`). Any wording change
bumps the version, invalidates the cache, and needs re-calibration.

- **Sensitive** (risk features; ≥ `sensitiveMedium` 0.5 → review band):
  `touchesAuthn`, `touchesAuthz`, `handlesSecrets`, `addsNetworkCall`,
  `changesDependencyManifest`, `weakensInputValidation`,
  `removesErrorHandling`, `changesDbSchema`, `changesConcurrency`.
- **Escalating** subset (≥ `sensitiveHigh` 0.85 → escalate): authn, authz,
  secrets, input validation, DB schema. Dependency bumps etc. go to the review
  band, not straight to a human.
- **Low-risk evidence**: `isTestOnly`, `isDocsOrCommentsOnly`, `isFormattingOnly`.
- **Injection tripwire**: `addressesReviewerOrAutomation` — "does the code
  address reviewers/bots claiming approval?" ≥ 0.5 → escalate.
- **Choice** `changeKind` and **Score** `blastRadius` (0–4).

Counting, sizes, and arithmetic stay in code — Jev is weak at them.

## State is code only

The model sees `{ path, area, hunk }` and nothing else — never the PR body,
commit messages, or review comments (author-controlled prose is the easiest
injection vector). Code comments remain, which is what the tripwire and the
authority rules below are for. Hunks larger than the token budget (24k, under
Jev's 32k state+question limit) are split on line boundaries, each part
re-carrying the header; a single oversize line, or a file GitHub returned
without a patch (binary/too large), is **not evaluable** and routes to the
review band — unknown is never treated as low risk.

## Bands

Computed in `signals/aggregate.ts`, in precedence order:

1. **escalate** — any policy hit, an escalating signal ≥ 0.85, or the injection
   tripwire ≥ 0.5.
2. **review-with-rationale** — any sensitive signal ≥ 0.5, or any unit not
   evaluated. The Eve agent writes the rationale Jev can't.
3. **fast-path** — all of: no policy hit; every path in an allowlisted category
   (docs/test) *or* every unit formatting-only ≥ 0.9; every sensitive and
   tripwire signal < 0.1; `changeKind` ∈ {docs, test, formatting} with
   confidence ≥ 0.8; every unit evaluated.
4. **standard** — everything else (plain TCM).

## Asymmetric authority

- Signals may always **raise** risk: `escalate`, the review band, and
  `m ≥ 1` (a longer `w*`).
- Signals **never lower** risk. Fast-path eligibility is computed and logged —
  the would-be approval — but `m < 1` is never applied.
- Risk features (every `max:` signal and `blastMax`) have weights clamped to
  `≥ 0` wherever they come from (config or calibration), so a stronger risk
  signal can never lower the score. Calibration fits them with non-negativity
  constraints.

An attacker therefore has to move a whole change into an allowlisted category,
not flip one verdict — and even then, approval is only logged.

## Bot review actions (approval is stubbed)

A code-review bot acts through the GitHub pull-request review API.
`planReviewActions` (`actions/review.ts`) maps each open-PR decision to one:

| action | GitHub call | when |
|---|---|---|
| `defer_to_human` | `pulls.createReview { event: "COMMENT" }` + `pulls.requestReviewers` (`jev.humanReviewers`) | `escalate`; or review band in active mode |
| `request_changes` | `pulls.createReview { event: "REQUEST_CHANGES" }` | TCM `request-changes` (not re-issuing a human's own) |
| `approve` | `pulls.createReview { event: "APPROVE" }` | TCM `auto-approve`, or fast-path in active mode |

Deferral beats approval. The only actuator in this build is
`LoggingReviewActuator`: it persists the exact call (with `commit_id` = head
SHA, idempotent per pull × SHA × action) to `review_actions` and sends
nothing. A live octokit actuator is a later, explicit enablement and should
require the calibration artifact's **fast-path gate** to pass.

## Calibration (`pullup calibrate`)

Labels come from the repo's own history: a merged PR is positive when it later
shipped a defect proxy (revert / hotfix / follow-up fix / reopen).

- **Fit:** ridge logistic regression (fixed-iteration IRLS, deterministic,
  non-negative on risk features) over PR features: per-question max
  probability across hunks, tripwire, blast radius, weakest low-risk evidence,
  log unit count. There's no per-question Platt scaling: history has ground
  truth for "did this PR ship a defect", not for "does this hunk touch auth";
  the aggregate fit absorbs per-question scale and bias.
- **Metrics (5-fold out-of-fold):** AUROC, **adaptive (equal-mass) ECE**, Brier,
  per-feature AUROC, and a reliability table. Adaptive ECE is gated because
  predictions skew toward a low base rate, which leaves equal-width upper bins
  nearly empty and noisy.
- **Backtest:** replays every labelled PR under rules-only `w*` vs
  Jev-raised `w*` and compares realised cost: `D(w) + [defect]·C_defect·(1−e(w))`.
- **Multiplier gate** (defaults): ≥ 200 labelled PRs, ≥ 20 defects, AUROC ≥
  0.75, adaptive ECE ≤ 0.05, backtest cost ≤ rules-only.
- **Fast-path gate** (separate): fast-path precision ≥ 0.98 on merged PRs.
  It doesn't affect the multiplier; it's the bar for ever un-stubbing approval.

The artifact (`calibration.json`) is versioned and integrity-hashed. It
applies only when its model id, question-set version, and repo all match, and
its hash shows in report provenance.

**Synthetic reference run** (`fixtures/calibration`, 433 labelled, 64
defects): AUROC 0.80, adaptive ECE 0.071 (uncalibrated 0.107), backtest
−571 dev-hours vs rules-only. The **multiplier gate fails on ECE** and the
**fast-path gate fails at 0.89 precision**, because synthetic docs PRs ship
defects at the same rate as the rest. That's the gate doing its job: the
multiplier stays at 1 and approval stays stubbed.

## Models

`SignalModel` is a port in `@pullup/core`; core never calls the network.

| model | where | use |
|---|---|---|
| `JevSignalModel` | `@pullup/jev` | Live, via `@typesafe-ai/sdk` (`systemOne`). Pinned `jev-1.13.0`. The SDK retries 408/429/5xx (incl. 529); the adapter adds a requests/minute limiter and a concurrency cap. A failed unit returns `null` (unknown risk). |
| `SyntheticSignalModel` | `@pullup/core/testing` | Deterministic stand-in: a keyword oracle plus seeded noise, **deliberately miscalibrated** per question, and it reproduces the published injection effect (reviewer-addressed "pre-approved" text drags sensitive probabilities down). Offline default with no key. |
| `ReplaySignalModel` | `@pullup/core` | Exact recorded answers keyed by state hash. A miss throws. Record with `pullup signals --record <file>`. |

Model selection: `--model` / `PULLUP_SIGNAL_MODEL`, else `jev` if
`TYPESAFE_API_KEY` is set, else `synthetic` (and every report says so).

## Cost and caching

Answers are cached in `signals` keyed by `sha256(model ∥ question set ∥ state)`,
so a re-push re-evaluates only the hunks that changed. Every run records tokens,
cost, cache hits, failures, and the provider-reported model id (drift from the
pinned id is flagged) in `signal_runs`. `jev.budgetUsdPerRun` hard-stops a run,
and units left over become unknown risk. Typical cost: a few thousand tokens per
hunk, about **$0.0002–$0.006 per PR**. The whole 600-PR synthetic history cost
$0.026.

## Data residency

The live model sends diff hunks to TypeSafe's API. ZDR is enterprise-only on the
direct API. Enabling `jev` with a key is an explicit, per-repo opt-in to sending
code to a third party.

## Known blind spots

- **Cross-file bugs:** per-hunk evaluation can't see a removed check in one file
  combined with a new caller in another. Jev only raises and routes risk; it
  never certifies safety outside the allowlist.
- **Labels are noisy:** defect proxies are heuristics with a low base rate.
  Gates require minimum counts.
- **Eval independence:** eve's default judge is also Jev, so safety evals assert
  on tool output deterministically and `t.judge` only grades prose.
