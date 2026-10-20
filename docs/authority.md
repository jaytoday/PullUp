# Authority: PullUp × Agent Baseline

> **PullUp decides. The authorizer authorizes. GitHub enforces. Evidence proves what happened.**

PullUp's engine decides what *should* happen to a pull request (approve,
request changes, ask a human). This layer decides, separately, whether PullUp
is *allowed* to make it happen, on which repository, with which GitHub
permissions, and for how long. It implements a subset of the
[Agent Baseline](../../../libraries/agentbaseline/whitepaper/controls.yaml)
controls (v1.0-draft). Agent Baseline is a specification, not a library, so
the control identifiers are cited in code, tests and evidence.

Nothing here changes a decision: bands, `w*`, guardrails and
`planReviewActions` output are byte-identical. The layer can only **lower**
what is sent.

## The flow

```
planReviewActions           (decision, unchanged)
  → governPlan              task id · authorize · lower · permit       core/src/authority/
  → actuator                re-check permit now · mint scoped token ·  github/src/actuator.ts
                            send · verify · revoke
  → evidence                append-only, hash-chained rows             core/src/authority/evidence.ts
```

Every surface (CLI `pullup actions`, dashboard `POST …/actions`, the agent's
`log_review_action`) makes the same `governPlan` call after planning.
Read-only views (`GET …/report`, `GET …/pulls/:n`) show the authorization but
never issue a permit.

## What decides the effective level

The repo's **action mode** (`actions.*`, plus the approval gate) is the
*policy*: what PullUp wants to send. The effective level is the lowest of:

| input | effect | control |
|---|---|---|
| Capability profile the repo is enrolled in | `observe` → comment only · `review-block-only` → never approves · `review` → may act | CON-04 |
| This agent version's status | `pending` (new composition hash) → comment only · `quarantined` → deny | DIS-01, RES-02 |
| Credential (live only) | personal token (`GITHUB_TOKEN`) → comment only; acting needs a GitHub App | AUT-04 |
| Stop switch (global or repo) | on → deny every write | RES-01 |
| Missing input (stop switch unreadable, version unknown, live without `PULLUP_PERMIT_KEY` or credentials) | deny | AUT-06 |

The result is recorded on each action as `authorization`:
`allow` · `allow-comment-only` · `deny`, with `reasons`, the `controls` it
evidences, and the minimum GitHub `permissions`.

A repo that was never enrolled is `observe`. Enrollment, approving an agent
version and resuming after a stop are **CLI-only**, because the dashboard API
has no authentication (the same reason live delivery is an environment
variable). Stopping is allowed from the dashboard too: it only removes
authority.

## Permits (AUT-02)

For a live send, `governPlan` issues a permit: HMAC-SHA256 (key
`PULLUP_PERMIT_KEY`) over the task id, repo, pull request, head commit, action,
level, config hash, agent id + version, GitHub permissions, a hash of the
exact GitHub call, issue/expiry time (5 minutes) and a nonce.

Immediately before any GitHub call, `checkExecution` re-validates it:
signature, expiry, binding to this action and call, the process's agent
version, the stop switch, the agent's status (quarantined → deny; acting needs
`approved`), the repo's **current** config hash, and finally consumes the
nonce (single use). Any failure records the action `denied` before GitHub is
touched. Permits are never persisted and never shown to the model.

## Credentials (AUT-04)

With a GitHub App, each action gets its own installation token minted for
**one repository** and the **minimum permissions** (`pull_requests: write` to
act, `pull_requests: read` + `issues: write` to comment), and revoked
(`DELETE /installation/token`) right after, whatever happened. GitHub tokens
cannot be shortened below an hour, so revocation is what keeps the window
short. The record stores the token's repositories, permissions and whether
revocation succeeded — never the token.

## Verification (VAL-04)

After sending, the actuator re-reads GitHub: the review exists, has the
planned event (APPROVED / CHANGES_REQUESTED) and is on the planned commit; the
comment carries this task's `<!-- pullup:task=… -->` marker. A mismatch
records the action `failed` with `verification: …`.

## Agent identity (DIS-01, DIS-05)

An agent's version is a **composition hash**:

- `pullup/eve` — `agent/agent.ts`, `agent/instructions.ts`, every
  `agent/tools/*.ts`, the `@pullup/core` version, the base question-set
  version and the model id (`PULLUP_MODEL`);
- `pullup/cli`, `pullup/dashboard` — the same minus the agent files.

Editing the instructions or a tool is a new identity: it starts `pending` and
may only comment until `pullup agents approve <hash>`. The hashed inputs are
stored with each version, so "which tasks ran on this version" is a query.

## Evidence (OBS-02, OBS-05, OBS-06)

Table `evidence`, append-only (an SQLite trigger refuses updates). Each row:
`repoId`, `seq`, `taskId`, `agentVersion`, `kind`
(`planned` · `authorized` · `denied` · `credential` · `sent` · `logged` ·
`skipped` · `verified` · `failed` · `revoked` · `control`), `payload`,
`prevHash`, `hash`. Each repo is its own chain; global controls (stop, agent
approvals) chain under `global`. `pullup evidence verify` walks the chains and
reports edited or missing rows. `review_actions` stays the mutable
"latest state" table the dashboard lists.

The dashboard's evidence sheet (Actions → *Evidence*) shows
WHY · WHAT · RISK · AUTHORITY · ACTION · OUTCOME · VALIDATION · VERSION, built
only from evidence rows, plus whether the repo's chain is intact.

## Operator commands

| command | what |
|---|---|
| `pullup enroll <repo> <observe\|review-block-only\|review>` | Set the repo's ceiling |
| `pullup agents` | List versions; registers this checkout's cli / dashboard / eve versions |
| `pullup agents approve <hash>` / `quarantine <hash>` | Hash or ≥ 6-character prefix |
| `pullup stop [--repo r] [--reason t]` / `pullup resume [--repo r]` | Stop switch |
| `pullup evidence <taskId>` / `pullup evidence verify [--repo r]` | Evidence |
| `pullup impact --agent-version <hash>` | Every task a version ran and the GitHub ids it touched (RES-03) |

Dashboard: Settings → **Authority** (global stop, prerequisites, agent
registry); each repo's Actions page → **Authority** panel (profile, this
version's status, repo stop) and the evidence sheet. API:
`GET /api/control`, `POST /api/control/stop`, `GET /api/repos/:o/:r/control`,
`GET /api/tasks/:taskId/evidence`. There is no resume route.

## Going live, step by step

1. GitHub App credentials (see `docs/github.md`), `PULLUP_GITHUB_DELIVERY=live`,
   and a random `PULLUP_PERMIT_KEY` (e.g. `openssl rand -hex 32`).
2. `pnpm pullup enroll owner/repo review` (or a lower profile).
3. `pnpm pullup agents`, then `pnpm pullup agents approve <hash>` for each
   version that should act.
4. The repo's action mode still applies, and Approve · Act still needs the
   passing fast-path calibration gate.

## Conformance suite

`packages/github/src/conformance.test.ts` runs the proposal's scenarios
offline (fake GitHub client, fake credential broker), each test named after
its control: scoped + revoked + verified approval, high risk never approves,
profile ceiling, unenrolled = observe, expired / forged / altered / replayed
permits, config drift, quarantine, stop (global and per repo), missing permit
key, personal token, unapproved version, verification mismatch, tampered
evidence, impact, and the logging-mode invariant. Pure authorizer tests live
in `packages/core/src/authority/authority.test.ts`.

## Not covered

- Autonomous merge (a later profile: needs `contents: write`, required-check
  reading and merge-method choice).
- Multi-agent delegation (AUT-03) and a separate approval workflow (AUT-05):
  asking a human already makes the human's own GitHub review the independent
  decision.
- The App token minting and revocation path is tested with fakes only.
- The Eve GitHub channel posts the agent's conversational reply as a PR
  comment using the App's standing credentials. That reply is not governed by
  this layer (review actions are; they go only through `log_review_action`).
  Governing channel replies would mean routing them through the same permit
  and scoped-token path.
