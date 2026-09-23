# PullUp — the two-cost model

The core question: **how long should a PR wait for human review before it is
cheaper to ship it and fix the resulting bugs later?**

Two competing costs, both measured in dev-hours:

- **D(w) — cost of waiting.** Value lost while a change sits un-reviewed.
- **E(w) — cost of shipping before review.** The expected rework when a defect
  slips through.

A PR's optimal max-wait `w*` is the point where the marginal costs cross:
review pays while the marginal benefit of one more hour of review exceeds the
marginal cost of one more hour of wait.

## Waiting cost D(w)

```
D(w) = r_v · w + Δ_ctx · 1[w > T_cold] + C_conflict(w)
```

- `r_v` — value lost per hour of wait. Baseline `valueDelayRatePerHour`,
  **congestion-inflated** by the queue depth `κ` (see below).
- `Δ_ctx` — a **cold-start surcharge** paid once a PR waits past
  `coldStartThresholdHours`: the reviewer must reload the context, worth
  `coldStartCostHours` in dev-hours.
- `C_conflict(w)` — merge-conflict risk. Conflicts occur at
  `conflictRatePerHour`, each costing `conflictResolutionHours`; the chance a
  PR has accumulated a conflict grows with its age.

`r_v` is measured per repo:

```
κ = open-prs-awaiting-review / active-reviewers
r_v = valueDelayRatePerHour · (delayCongestionWeight · κ + (1 - delayCongestionWeight))
```

## Shipping-before-review cost E(w)

```
E(w) = P_defect · (1 − e(w)) · C_defect
e(w) = e_max · (1 − exp(−w / T_review))
```

- `P_defect` — probability the change ships a defect, **per change type**
  (feature/bugfix/refactor/dependency/docs/other), shrunk toward priors.
- `e_max` — review efficacy at full review (fraction of ship-risk removed),
  measured from the repo (defect-proxy rate among merged PRs with vs without
  review findings), shrunk toward `efficacyPrior`, congestion-damped by the same
  queue metric.
- `T_review` — `reviewWindowHours`, the hour-scale on which efficacy saturates.
- `C_defect` — `defectReworkHours × escalationMultiplier` (rework dev-hours
  × 15x escalation for shipped-bug cost).

## Shrinkage

Sparse per-type data over-fits. Per-type `P_defect` is shrunk toward the
per-type prior:

```
P_defect(type) = (typeDefectPriorWeight · prior(type) + measured(type))
                 / (typeDefectPriorWeight + n(type))
```

The repo-wide rate is shrunk toward `defectPrior` with `defectPriorWeight`.
`e_max` shrinks toward `efficacyPrior` with `efficacyPriorWeight`. When a repo
has no defect signal at all (`e_max ≤ 0`), efficacy falls back to
`efficacyPrior`.

## The decision rule

For each open PR, given wait so far `w`, net value `V = changeValue`, and the
computed `w*`:

1. `state` merged/closed → **review-complete**.
2. last review `CHANGES_REQUESTED` → **request-changes**.
3. last review `APPROVED` → **review-complete**.
4. `V − E − D < 0` (already net-negative) → **request-changes**.
5. `w ≥ w*` → **auto-approve**.
6. else → **keep-reviewing**.

`findOptimalWait` scans `w` from `minWaitHours` to `maxWaitHoursCap` (1h grid)
minimizing `F(w) = D(w) + E(w)`.

## Priors (defaults, `DEFAULT_PRIORS`)

| prior | default | meaning |
|---|---|---|
| `valueDelayRatePerHour` | 0.1 | dev-hours lost per hour of wait |
| `coldStartThresholdHours` | 24 | wait after which context reload is paid |
| `coldStartCostHours` | 2 | context-reload cost in dev-hours |
| `conflictRatePerWeek` | 0.2 | merge-conflict probability per week |
| `conflictResolutionHours` | 1.5 | hours to resolve a conflict |
| `escalationMultiplier` | 15 | shipped-bug cost escalation |
| `defectReworkHours` | 8 | rework dev-hours per defect |
| `defectPrior` | 0.05 | repo-wide prior defect rate |
| `defectPriorByType` | feature 0.06, bugfix 0.08, dependency 0.03, refactor 0.05, docs 0.01, other 0.05 | per-type priors |
| `defectPriorWeight` | 20 | shrinkage weight, repo-wide |
| `typeDefectPriorWeight` | 15 | shrinkage weight, per type |
| `reviewWindowHours` | 24 | efficacy saturation scale |
| `efficacyPrior` | 0.5 | prior efficacy when no signal |
| `efficacyPriorWeight` | 10 | shrinkage weight for efficacy |
| `changeValueHoursByType` | feature 16, bugfix 8, refactor 8, dependency 4, docs 4, other 4 | net value of a change |
| `delayCongestionWeight` / `efficacyCongestionWeight` | 0.7 / 0.3 | how much congestion inflates wait cost / damps efficacy |
| `maxWaitHoursCap` | 168 | w* never exceeds a week |
| `minWaitHours` | 1 | w* never below an hour |
