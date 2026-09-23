# PullUp — analytics

The `AnalyticsReport` is what the cost model consumes. All metrics are computed
from an ingested repo's stored PR history (via the `PullStore` seam).

## Sections

- **latency** — per dimension (overall, area, size): n, p50, p90 of
  `timeToFirstReview`, `totalReviewTime`, and `wait` (open → merge/close).
  Durations are clamped to ≥ 0.
- **outcomes** — merged PRs bucketed by wait time (`≥6h`, `≥12h`, …, `≥168h`):
  approval rate, changes-requested rate, shipped-defect rate per bucket, plus
  Pearson correlations of wait vs approval and wait vs changes. The ≥168h tail
  folds into the last bucket.
- **defects** — defect-proxy rate per change type and overall. A *defect proxy*
  is a `revert` / `hotfix` / `follow-up fix` / `reopen` event recorded against a
  merged PR (fixtures inject them; the live adapter reads the issue timeline).
- **efficacy** — measured and shrunk `e_max`: defect-proxy rate among merged
  PRs whose review *found* findings (`hadFindings`) vs those it cleared, turned
  into a fractional ship-risk reduction. Falls back to `efficacyPrior` when
  there's no signal (`e_max ≤ 0`).
- **congestion** — daily queue: open-PRs-awaiting-review ÷ active reviewers,
  per day, with current κ. Days are capped at "today".

## Derived fields

- `hadFindings` (on `PullRecord`) — true if **any** review on the PR was
  `CHANGES_REQUESTED`. This is what efficacy measures, so a single findings
  review marks the PR as caught-by-review regardless of the final state.
- `reviewOutcome` — the **last** review state (APPROVED / CHANGES_REQUESTED /
  COMMENTED / null if none).

## Determinism

All of it runs on stored records with an explicit `now` (report generation
timestamp). Same store + same priors + same `now` ⇒ byte-identical report. This
is what makes the offline eval suite deterministic.
