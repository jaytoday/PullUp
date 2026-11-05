# Safety and the record

How PullUp makes sure it only sends what it decided, and can show afterwards what it did.
([Back to the overview](README.md))

## The governed sender

Every write to GitHub (the PullUp check, a reminder comment, the optional rerun) goes through one
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

Each repository has an append-only chain of entries: collected, decided (with every extension's
version and output), permit issued, sent, blocked, asked, answered. Each entry stores the hash of the
one before it, so an edited or deleted entry shows up. The run page says whether the chain is intact.

## Other protections

- The config only comes from the default branch, so a pull request cannot loosen its own checks.
- AI answers are checked: the right shape, and quotes that really are in the change.
- Extensions cannot reach the network or soften another extension's question
  ([Extensions](extensions/README.md#rules-every-extension-keeps)).
- Settings that make PullUp pass more easily need "loosen" typed to confirm.

The full list of threats PullUp resists, and where each control lives in the code, is
[PullUp's threat model](threat-model.md).
