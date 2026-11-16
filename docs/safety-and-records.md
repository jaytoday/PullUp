# Safety and the record

How PullUp makes sure it only sends what it decided, and can show afterwards what it did.
([Back to the overview](README.md))

## The governed sender

Every write to GitHub (the PullUp check and the optional rerun) goes through one
module, `packages/github/src/send.ts`, in this order:

1. **The stop switch.** If it is on (in Settings, or `PULLUP_STOP=1`), nothing is sent.
2. **A permit.** A single-use permit is signed with `PULLUP_PERMIT_KEY` for this exact call (by its
   hash). Without a key, nothing is sent.
3. **The permit is checked again** right before sending: its signature, that it has not expired (five
   minutes), that it covers this exact call, and that it was not used before.
4. **The call.**
5. **The record** (below). A refusal or a failed call is recorded too.

PullUp never merges, changes branch protection or reverts anything.

## The record

Each repository has an append-only chain of entries: collected, assessed (each concern's provider, answer and decision id), decided, permit issued, sent, blocked, answered (a person's GitHub answer) and outcome. Each entry stores the hash of the one before it, so an edited or deleted entry shows up when the chain is walked (`verifyChain` in `packages/engine/src/evidence.ts`).

## Other protections

- The config only comes from the default branch, so a pull request cannot loosen its own checks.
- The check comes from typed answers through a fixed rule, never from the agent's text. A `risky` answer fails only with a quote that really appears in the change or the logs; Enforce mode never passes on simulated answers.
- The agent's tools are bounded and checked in code ([the agent](the-agent.md)); text from pull requests and logs is data, never instructions.
- Only listed reviewers and admins can answer from GitHub.
- The AskWithAI key stays on the server; the web kit's route forwards only allow-listed calls for PullUp's runtime, for signed-in users.
