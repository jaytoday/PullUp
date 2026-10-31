# GitHub integration

PullUp connects to GitHub in three ways, all through one GitHub App:

| direction | what | where |
|---|---|---|
| **in** — webhooks | PR opened / synchronize / ready_for_review / review_requested, and `@mentions`, start an agent turn | `agent/channels/github.ts` (eve `githubChannel`) |
| **read** — history | PRs, files and patches, reviews, review comments, and timeline defect proxies | `OctokitPullSource` (`packages/github/src/octokit.ts`) |
| **write** — review actions | the decision comment, reviews (APPROVE / REQUEST_CHANGES) and reviewer requests | `GitHubReviewActuator` (`packages/github/src/actuator.ts`) |

Writes are **off by default**. Every surface (CLI, dashboard, agent) logs the
planned calls to `review_actions` until an operator turns delivery on. Even
then, every write is authorized separately — repo profile, agent version,
stop switch, a signed per-action permit and a per-action token. See
`docs/authority.md`.

## Setup

1. Create a GitHub App.
   - **Repository permissions:** Pull requests *read & write* (this also
     covers the decision comment: on a pull request GitHub only lets an App
     comment with pull-request write, even through the issue-comment API),
     Issues *read*, Checks *read & write*
     (only needed when the PullUp check is on), Contents *read*, Metadata *read*.
   - **Webhook events:** Pull request, Issue comment, Pull request review
     comment.
   - **Webhook URL:** the eve deployment's GitHub channel route.
2. Install it on the repos PullUp should watch.
3. Set the environment (the channel and the read/write clients share it):

| var | meaning |
|---|---|
| `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` | App credentials. The key may use escaped `\n`. The agent's GitHub channel (eve) reads `GITHUB_APP_PRIVATE_KEY`; when that is unset it is filled from `GITHUB_PRIVATE_KEY`. |
| `GITHUB_WEBHOOK_SECRET` | Verifies inbound webhooks (eve channel) |
| `GITHUB_APP_SLUG` | The bot's `@mention` name |
| `GITHUB_INSTALLATION_ID` | Optional: skips the per-repo installation lookup |
| `GITHUB_TOKEN` | Fallback when no App is configured (PAT or Actions token). It cannot be narrowed, so it may only **comment**; acting needs the App. |
| `GITHUB_API_URL` | Optional: GitHub Enterprise API base |
| `PULLUP_GITHUB_DELIVERY=live` | **Turns writes on.** Any other value, or unset, means logging only. |
| `PULLUP_PERMIT_KEY` | Signs per-action permits. **Required for live writes**: without it every send is denied. |

Delivery is an operator switch (environment), not a repo setting. The
dashboard's settings API has no auth, so it must not be able to turn on
outbound writes. What gets sent per repo is still controlled by the repo's
**action mode** (Off / Evaluation / Block only / Full, `actions.*`).

## What gets sent

`planReviewActions` decides, the action mode shapes (`docs/configuration.md`),
and the authority layer may lower it further (`docs/authority.md`: profile,
agent approval, credential). The actuator only carries out the result:

| authority | action | GitHub calls |
|---|---|---|
| `off` | any | none (recorded `suppressed`) |
| `comment` | any | one PullUp decision comment, edited in place ("PullUp would …") |
| `act` | approve | `pulls.createReview APPROVE` pinned to `commit_id` = planned head |
| `act` | request changes | `pulls.createReview REQUEST_CHANGES` pinned to the planned head |
| `act` | ask a human | decision comment + `pulls.requestReviewers` |
| any but `off` | any, with `inline.enabled` | also new inline finding comments (one `COMMENT` review) and resolution of PullUp's own fixed threads — see below |
| any but `off` | any, with `checks.enabled` | also one PullUp check run on the head (`checks.create`, or `checks.update` when one with the same name exists) |

### The PullUp check

With `checks.enabled`, every action also posts a check run named `checks.name`
(default "PullUp") on the planned commit, with the decision as its summary and
located findings as line annotations (P0 failure · P1 warning · P2 notice, at
most 50). Its conclusion never makes approval easier than the review itself:

| action | level | conclusion |
|---|---|---|
| approve | `act` (gate passed) | `success` |
| approve | `comment` or clamped | `neutral` ("PullUp would approve (approval locked)") |
| request changes | `act` and `checks.blockOn = "request-changes"` | `failure` |
| request changes | otherwise | `neutral` |
| ask a human | any | `neutral` |
| any | `off` | no check |

GitHub treats `neutral` as passing for a required check, so a required PullUp
check blocks a merge only through `failure`. In Evaluation it only proves that
PullUp ran. Asking a human never fails the check: once a human reviews, PullUp
stops acting on the pull request, so a failing check would be left behind.
Governance lowers the check with the action (a standing token or an Observe
profile → `neutral`; stop switch → nothing is sent, so a required check stays
pending until PullUp is resumed or the requirement is removed). The token for a
check carries `checks: write` on top of the action's usual permissions, and
verification re-reads the check's head and conclusion.

**Approve · Act is gated.** A real APPROVE needs live delivery *and* this repo's
calibration artifact (`.pullup/calibration.<owner>__<repo>.json`, or
`jev.calibrationPath`) with a **passing fast-path gate** (`approvalGate` in
`packages/core/src/actions/approval.ts`). Until both hold, the plan clamps it to
a comment and records the reason in `clamped`. Request changes and ask-a-human
need only live delivery, because they add friction and never remove it.

### Inline finding comments

With `inline.enabled`, located risk-signal findings (P0–P1 by default) are
posted as inline review comments: one `COMMENT` review per head carrying the
new comments, each ending in a hidden `<!-- pullup:finding:v1:<key> -->`
marker. The key is a hash of the finding id and file path, so the same concern
on the same file keeps its comment across pushes.

- **No duplicates:** a finding whose comment is still open is kept, not
  re-posted. Before posting, the actuator also skips any comment whose marker
  is already on the pull request.
- **Resolving:** when a later head no longer has the finding (and the file
  was fully evaluated, and signals ran), or the file left the pull request,
  PullUp replies "No longer flagged at `<sha>`" and resolves the thread
  (GraphQL `resolveReviewThread`), at most `inline.maxResolutions` per run.
- **Only its own:** PullUp resolves only threads it recorded posting in
  `finding_comments` (written only after GitHub accepted the review). A human's
  comment, even one that pastes PullUp's marker, is never resolved; it only
  stops PullUp from posting a duplicate.
- **Human resolutions stick:** a thread a human resolved is recorded as
  `resolved-by-human`, and that finding is not posted again on that file.
- **Not posted** on a pull request where the injection tripwire fired, for
  repos enrolled in the Observe profile (which promises only the decision
  comment), or at `off`. They are information only and never change the action.
- The token for these calls carries `pull_requests: write`. If branch
  protection requires conversation resolution, PullUp's open threads count
  toward it; resolving only ever undoes threads PullUp itself opened.

## Safety properties of the actuator

- **Authority first:** an action the authorizer denied is recorded `denied`.
  Otherwise its permit is re-checked immediately before any call (expiry,
  single use, same call / head / config hash / agent version, stop switch,
  quarantine); any failure is `denied` before GitHub is touched.
- **Per-action token:** with an App, a token for this one repo and the minimum
  permissions is minted for the action and revoked after it.
- **Verified:** after sending, the review is re-read (event and commit) and
  the comment is found by its task marker; a mismatch is `failed`.
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
  an act-level action dismisses PullUp's *own* earlier REQUEST_CHANGES reviews
  and records their ids in `delivery.dismissedReviewIds`. A comment-only action
  never dismisses (that would unblock a merge without authority to act).
- It never merges and never touches branch protection.

## Surfaces

- **CLI:** `pullup fetch owner/repo` reads live (App or token).
  `pullup actions owner/repo --send`, or `PULLUP_GITHUB_DELIVERY=live`, sends.
  The exit code is 1 when any action failed.
- **Dashboard:** *Apply actions* sends when delivery is live, and returns 503
  with the reason if credentials are missing. The Actions page shows each
  record's status (Logged / Sent / Skipped / Denied / Failed / Suppressed),
  any errors or denial reasons, and the evidence sheet. `GET …/config` returns `approval.{liveActuator, unlocked, lockedReason}`.
- **Agent:** on a webhook turn it refreshes the PR (`ingest_repo` with
  `pullNumbers`; the first time, the full history), runs `triage_pull`, then
  `log_review_action` with its rationale. The tool returns `sent`, `status`,
  `taskId`, `authorization` (decision and reasons) and `deliveryDetail`, so the
  agent never claims a send that didn't happen. It never sees a permit or token.

## Not covered

- The App path was tested live on a private sandbox repo (2026-10-30): per-action
  tokens minted for one repo and revoked, the check run (neutral, failure,
  annotations, update in place), a REQUEST_CHANGES review and its dismissal
  after a fix push, the approval lock, and a webhook-driven agent turn. A
  successful reviewer request was not tested: the sandbox had no collaborator
  other than the pull request's author.
- The check reports the decision at planning time. It doesn't count down the
  wait window (`w*`); nothing re-plans a pull request when `w*` passes except
  the next webhook or an explicit run.
- A full first ingest of a large repo is one `pulls.listFiles` call per PR, so
  expect it to be slow the first time.
