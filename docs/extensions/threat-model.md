# `threat-model`: checking changes against a threat model

([Back to extensions](README.md))

The repository keeps a threat model in `THREATS.md` (or sections of `SECURITY.md`) on the default
branch, in the layout of the Warden DNS resolver's public threat model:

```md
## In scope
| ID | Threat | Control | Code |
| --- | --- | --- | --- |
| T3 | Forged webhook | Signature check with constant-time compare | `src/webhook.ts` → `verifySignature` |
## Out of scope
- ARP spoofing: handled by the network layer.
## Operator contract
- `branch-protection-requires: PullUp` — Branch protection requires the PullUp check.
## Entry points
- `src/app/api/**/route.ts`, `fetch(`
```

- **In scope**: each threat, the control that stops it, and where that control lives in the code
  (several places separated by `;`).
- **Out of scope**: threats left to another layer, named on purpose.
- **Operator contract**: settings the operator must turn on.
- **Entry points**: ways into the system. In backticks: file patterns (a new matching file), or code
  that an added line contains (anything with `(`).

## What it checks (plain code, no model)

| Question | Raised when | A person decides? |
| --- | --- | --- |
| `threat-model:T3` | A changed line is inside the code a control lives in (the named function, when one is given). | Yes, unless `controlsCouncilMayPass` |
| `threat-model:drift-T3` | The change deletes or renames that code. | Yes |
| `threat-model:entry-point` | A new file or line matches an entry point that no threat covers. | No |
| `threat-model:model-weakened` | The change removes a threat, moves one out of scope, drops a contract item, or makes the file unreadable. | Yes |

The reviewers get the threat and its control as context, and the check shows the line on GitHub. A
missing or unreadable threat model is a note on every run, never a silent pass.

Once a day, PullUp also checks the threat model on the default branch itself: does it still parse,
and does every mapped file and function still exist? Settings shows what it found.

## Settings

`path` (default `THREATS.md`), `controlsCouncilMayPass` (default `false`; turning it on is a
loosening).

PullUp keeps its own threat model in this format: [PullUp's threat model](../threat-model.md).
