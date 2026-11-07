# The WithAI connection

([Back to the overview](README.md))

PullUp decides **what to ask** about a pull request; WithAI **answers, asks people, and learns**. PullUp is not a WithAI extension and WithAI holds no PullUp code: the two are joined only by WithAI's public API. WithAI's side is described in its own docs (`docs/apps.md` and `docs/platform-api/` in the WithAI repository).

## What PullUp uses

| PullUp needs | WithAI call | Where in PullUp |
|---|---|---|
| One answer per council seat | `apply`, cheap tier, the workspace's CI policy skill as guidance, the seat's viewpoint, profile `pullup-review` version 1 | `packages/engine/src/withai-council.ts` |
| Cheap screens (repository rules, the inert check) | `apply`, profile `pullup-screen` version 1 | `packages/engine/src/screens.ts` |
| A person's decision | Ask a person, linked to the CI policy skill with the run attached | `src/server/asking.ts` |
| The CI policy skill | `PULLUP_SKILL_ID`, or `POST /api/v1/skills { template: "ci-policy" }` once | `src/server/pipeline.ts` |
| Answers that arrive later | Signed webhooks, plus the worker looking every minute | `src/app/api/withai/`, `src/server/asking.ts` (`tickAsks`) |

## What PullUp sends back

When a person answers a question, PullUp reports each seat's **outcome** on the WithAI run that produced its answer: the seat said what the person decided → `correct`; the opposite → `incorrect`; "needs a person" → `partial`. The rule is `seatOutcomes` in `packages/engine/src/council.ts`. Reports use the key `person:<run>:<question>`, so seeing the same answer twice replaces rather than adds. A failed report is written to the run's record and never changes the check or the answer.

People's answers also become examples on the CI policy skill (WithAI calls these *labels*), so the seats' guidance improves; the [Accuracy page](dashboard.md) shows how often the council agreed with people.

## The profile

Every seat call carries `profile: { name: "pullup-review", version: 1 }` (`COUNCIL_PROFILE`), and every screen `pullup-screen` version 1 (`SCREEN_PROFILE`). **Bump the version when an answer shape (`seatAnswerSchema`, the screen schema) or the meaning of the request changes**, so WithAI never mixes outcomes from different versions.

## The client

`packages/withai-client` is a copy of WithAI's client. Do not edit it here: change the client in WithAI, then from this repository's root run

```bash
WITHAI_REPO=/path/to/withai-eve node scripts/sync-withai-client.mjs
```

The script writes `packages/withai-client/SYNCED.json`; the copy's own test fails if any file no longer matches it.

## Setup

`.env`: `WITHAI_URL` (WithAI's address), `WITHAI_TOKEN` and `WITHAI_WEBHOOK_SECRET`. Make the token in WithAI with the scopes PullUp uses:

```bash
pnpm api-token:create --name "PullUp" --actions apply,questions:read,questions:write,skills:read,skills:write,labels:read,outcomes:write \
  --webhook <PULLUP_URL>/api/withai/webhook
```

A token made before November 2026 lacks `outcomes:write`; outcome reports then fail (and are recorded as failed) until it is replaced. The WithAI server must be a version with outcomes (`POST /api/v1/runs/:id/outcomes`).

Without `WITHAI_URL` and `WITHAI_TOKEN`, the council and screens are not available: questions go to a person, and screens come back "not checked" (never a pass).
