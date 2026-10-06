# GitHub integration

PullUp connects to GitHub in three ways, all through one GitHub App:

| direction | what | where |
|---|---|---|
| **in** — webhooks | PR opened / synchronize / ready_for_review / review_requested, and `@mentions`, start an agent turn | `agent/channels/github.ts` (eve `githubChannel`) |
| **read** — history | PRs, files and patches, reviews, review comments, and timeline defect proxies | `OctokitPullSource` (`packages/github/src/octokit.ts`) |
| **write** — review actions | the decision comment, reviews (APPROVE / REQUEST_CHANGES) and reviewer requests | `GitHubReviewActuator` (`packages/github/src/actuator.ts`) |

Writes are **off by default**. Every surface (CLI, dashboard, agent) logs the
planned calls to `review_actions` until an operator turns delivery on.

## Setup

1. Create a GitHub App.
   - **Repository permissions:** Pull requests *read & write*, Issues *read &
     write* (the decision comment is an issue comment), Contents *read*,
     Metadata *read*.
   - **Webhook events:** Pull request, Issue comment, Pull request review
     comment.
   - **Webhook URL:** the eve deployment's GitHub channel route.
2. Install it on the repos PullUp should watch.
3. Set the environment (the channel and the read/write clients share it):

| var | meaning |
|---|---|
| `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` | App credentials. The key may use escaped `\n`. |
| `GITHUB_WEBHOOK_SECRET` | Verifies inbound webhooks (eve channel) |
| `GITHUB_APP_SLUG` | The bot's `@mention` name |
| `GITHUB_INSTALLATION_ID` | Optional: skips the per-repo installation lookup |
| `GITHUB_TOKEN` | Fallback for reads and writes when no App is configured (PAT or Actions token) |
| `GITHUB_API_URL` | Optional: GitHub Enterprise API base |
| `PULLUP_GITHUB_DELIVERY=live` | **Turns writes on.** Any other value, or unset, means logging only. |

Delivery is an operator switch (environment), not a repo setting. The
dashboard's settings API has no auth, so it must not be able to turn on
outbound writes. What gets sent per repo is still controlled by the repo's
**action mode** (Off / Evaluation / Block only / Full, `actions.*`).

## What gets sent

`planReviewActions` decides and authority shapes (`docs/configuration.md`). The
actuator only carries out the plan:

| authority | action | GitHub calls |
|---|---|---|
| `off` | any | none (recorded `suppressed`) |
| `comment` | any | one PullUp decision comment, edited in place ("PullUp would …") |
| `act` | approve | `pulls.createReview APPROVE` pinned to `commit_id` = planned head |
| `act` | request changes | `pulls.createReview REQUEST_CHANGES` pinned to the planned head |
| `act` | ask a human | decision comment + `pulls.requestReviewers` |

**Approve · Act is gated.** A real APPROVE needs live delivery *and* this repo's
calibration artifact (`.pullup/calibration.<owner>__<repo>.json`, or
`jev.calibrationPath`) with a **passing fast-path gate** (`approvalGate` in
`packages/core/src/actions/approval.ts`). Until both hold, the plan clamps it to
a comment and records the reason in `clamped`. Request changes and ask-a-human
need only live delivery, because they add friction and never remove it.

## Safety properties of the actuator

- **Stale-head guard:** before sending, it re-reads the PR. A closed or merged
  PR, or a head that moved past the planned sha, is recorded `skipped`. The next
  `synchronize` webhook re-plans the new head.
- **Idempotent:** a `(pull, head, action)` that was already `sent` is never sent
  again. A later logging run never overwrites it.
- **Partial failure:** if any call fails, the action is recorded `failed`, with
  per-call `delivery.errors` and what did land. A retry repeats only the failed
  calls, never a review that already posted.
- **One comment:** the decision comment is found by its stored id or the
  `<!-- pullup:decision -->` marker and edited in place. A deleted or foreign
  comment (403/404) falls back to a new comment.
- **No stale blocks:** when a later head no longer warrants a change request,
  PullUp dismisses its *own* earlier REQUEST_CHANGES reviews and records their
  ids in `delivery.dismissedReviewIds`.
- It never merges and never touches branch protection.

## Surfaces

- **CLI:** `pullup fetch owner/repo` reads live (App or token).
  `pullup actions owner/repo --send`, or `PULLUP_GITHUB_DELIVERY=live`, sends.
  The exit code is 1 when any action failed.
- **Dashboard:** *Apply actions* sends when delivery is live, and returns 503
  with the reason if credentials are missing. The Actions page shows each
  record's status (Logged / Sent / Skipped / Failed / Suppressed) and any
  errors. `GET …/config` returns `approval.{liveActuator, unlocked, lockedReason}`.
- **Agent:** on a webhook turn it refreshes the PR (`ingest_repo` with
  `pullNumbers`; the first time, the full history), runs `triage_pull`, then
  `log_review_action` with its rationale. The tool returns `sent`, `status`
  and `deliveryDetail`, so the agent never claims a send that didn't happen.

## Not covered

- The App auth path is tested with fakes only. Token auth was verified with a
  read-only live fetch.
- There is no check-run or commit-status output. The review itself is the CI
  signal, and branch protection can require an approving review.
- A full first ingest of a large repo is one `pulls.listFiles` call per PR, so
  expect it to be slow the first time.
