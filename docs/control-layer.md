# The control layer (`@pullup/control`)

PullUp decides when a pull request may skip waiting for a person. The same question comes up
wherever an AI acts on work items: may this insurance claim be paid without an adjuster, may
this submission be quoted without an underwriter? `@pullup/control` is that machinery with
neutral words (case, program, action, amount) and no dependencies besides Node.

> **The model recommends. The authorizer decides what may be done. A permit covers one exact
> call. Evidence proves what happened.**

## Pieces

| Module | What it does |
|---|---|
| `calibration` | Fits a small risk model (logistic regression) to the organization's own labelled history, measures it on cases it was not fitted on (AUROC, calibration error, Brier score), and applies two gates: one for using the model at all, a stricter one for automatic approval (precision of the auto path). Risk-signal weights are kept at zero or above. PullUp's core re-exports the metric functions from here. |
| `fairness` | Per-group rates and two checks before anything is automated: the adverse impact ratio (the four-fifths rule) and the gap in calibration error between groups. A group too small to measure fails. |
| `cost` | The two-cost rule for one case: review cost (handling + delay) against expected loss if acted on without review, plus the break-even risk. |
| `risk` | `combineRisk`: AI signals (possible fraud, possible exclusion) can only raise risk. |
| `reasons` | Plain-language reasons from the features that pushed this case's risk up, through a reason table. |
| `authority` | Profiles `observe` / `refer-only` / `act-within-limits`, an amount limit, stop switch, agent status, both gates. Adverse decisions (deny, decline, reduce) always go to a person. Missing inputs deny. |
| `permit` | HMAC-signed, five-minute, single-use permit bound to the exact call; re-checked right before acting. |
| `evidence` | Append-only, hash-chained rows per program with a storage port; `verifyChain` finds edits and gaps. |
| `decide` | `decideCase` → `recordDecision` → `carryOut`, tying it all together. |

## Example: insurance claims

`src/examples/insurance-claims.ts` has a claims feature set, a reason table, a cost rule and a
seeded synthetic claim generator. Run it:

```
pnpm control:demo            # fair data: small clean claims are paid automatically
pnpm control:demo --skewed   # one group is more often missing documents: the fairness gate fails and nothing is automated
```

## What is not here

Database storage for evidence and used permits (ports exist, memory versions are included),
connectors to claims or policy systems, and moving PullUp's own GitHub authorizer onto this
package. The GitHub-specific parts (scoped tokens, check runs) stay in `@pullup/core` and
`@pullup/github`.
