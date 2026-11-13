# PullUp's threat model

([Back to the overview](README.md))

PullUp is a security control in other teams' CI: a pull request should not be able to get past it
by changing it, fooling it or overloading it. This page says what PullUp resists, what it leaves to
other layers, what the operator must set up, and where each control lives in the code. It uses the
layout PullUp's own [`threat-model` extension](extensions/threat-model.md) reads, and PullUp's tests check the code map below
against the code (`packages/engine/src/threat-model-self.test.ts`), so moving a control without
updating this page fails the build.

## In scope

| ID | Threat | Control | Code |
| --- | --- | --- | --- |
| P1 | A pull request loosens PullUp's own checks | The config is read only from the default branch, never from the pull request | `packages/github/src/api.ts` → `defaultBranchConfig` |
| P2 | Prompt injection through the diff or logs makes a runtime pass a change | AskWithAI treats request input as evidence; PullUp still verifies citations for adverse answers and applies its resolution rule | `packages/engine/src/askwithai-council.ts` → `askWithAICouncil`; `packages/engine/src/council.ts` → `checkSeat` |
| P3 | A forged webhook starts or answers a run | Every GitHub delivery's signature is checked with a constant-time compare | `packages/github/src/webhook.ts` → `verifyWebhookSignature` |
| P4 | A replayed webhook delivery acts twice | Each delivery id is recorded once; a repeat is ignored | `src/app/api/github/webhook/route.ts` → `POST` |
| P5 | Someone who was not asked answers a question | Only the people asked, or a repository admin, can answer | `packages/engine/src/no-answer.ts` → `answer` |
| P6 | A GitHub write is repeated or changed after it was approved | Each write needs a signed permit for that exact call, used once | `packages/engine/src/permit.ts` → `checkPermit`; `packages/github/src/send.ts` → `governed` |
| P7 | Runaway cost from a large or hostile pull request | Bounded input, one decision call per question, request timeout, and a cap on questions and screens per run | `packages/engine/src/askwithai-council.ts` → `askWithAICouncil`; `packages/engine/src/host.ts` → `applyCouncilCap` |
| P8 | The record of what PullUp decided is edited afterwards | Evidence rows are hash-chained per repository; an edit breaks the chain | `packages/engine/src/evidence.ts` → `verifyChain` |
| P9 | An extension softens another's question or reaches the network | Extensions get frozen inputs, their output is parsed to a fixed shape, relaxations are host-owned, and a test allows them no imports but the SDK | `packages/engine/src/host.ts` → `runExtensions`; `packages/extensions/src/imports.test.ts` |
| P10 | A repository's data files (rules, this threat model) carry instructions to the runtime | PullUp labels repository content as evidence, and AskWithAI's prompt treats input as data rather than instructions | `packages/engine/src/askwithai-council.ts` → `askWithAICouncil`; AskWithAI's Decision API input handling |

## Out of scope

- A compromised GitHub account with admin rights: it can change branch protection and the default branch; GitHub's own audit log covers it.
- A compromised AskWithAI workspace or runtime: AskWithAI's access controls cover it; PullUp still verifies citations and applies its local rules.
- Bugs that every reviewer, human and AI, misses: PullUp reduces review load, it does not prove code correct.
- Denial of service against PullUp's server: the hosting layer covers it.

## Operator contract

- `branch-protection-requires: PullUp` — Branch protection on the default branch requires the "PullUp" check.
- `permit-key-set` — `PULLUP_PERMIT_KEY` is set; without it PullUp sends nothing to GitHub.
- `mode: active` — The repository is in Active mode; Shadow mode never blocks a merge.
- `core.sensitive-path on` — The core extension's sensitive path check is on and its CI category is not switched off.
- `webhook-secret-set` — `GITHUB_WEBHOOK_SECRET` matches the GitHub App's secret.

## Entry points

- `src/app/api/**/route.ts`, `worker/**/*.ts`, `fetch(`
