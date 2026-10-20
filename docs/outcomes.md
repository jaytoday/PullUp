# PullUp — decision outcomes and learnings

PullUp records what humans did after each of its decisions and turns repeated
patterns into **suggestions** (learnings). Nothing is applied automatically:
a suggestion opens as a settings draft that goes through the normal save flow
(preview, loosens/tightens labels, typed confirm for loosening, a version
with a note). No language model is used to derive outcomes or learnings.

## Outcomes (`outcomes/derive.ts`)

Derived on every read from stored data only — logged and sent review
actions, ingested reviews (with the commit each review was on, when known),
pull states, defect events (reverts, hotfixes) and PullUp's own inline
comments. Deterministic: the same store and clock give the same outcomes.

| action | outcome | rule |
|---|---|---|
| approve | `human-agreed-approve` | a human approved or it merged, and no revert/hotfix within `outcomes.defectWindowDays` (default 14) |
| approve | `human-overrode-approve` | a human requested changes, or a revert/hotfix followed within the window |
| ask a human | `ask-unneeded` | a human approved the **same commit** within `outcomes.quickApproveMinutes` (default 30) |
| ask a human | `ask-useful` | the human requested changes, or new commits came before the approval |
| ask a human | `ask-approved` | approved the same commit, but not quickly (counted neither way) |
| request changes | `changes-addressed` | new commits followed (or PullUp resolved its inline finding) and it merged |
| request changes | `changes-overridden` | merged on the commit PullUp blocked |
| any | `closed` / `pending` | closed without merging / not enough has happened yet |

Bot reviews and comment-only reviews don't count as a human response.
Reviews ingested before PullUp kept their commit fall back to the pull's
current head and are flagged *approximate*. Denied actions are skipped.

## Learnings (`outcomes/learn.ts`, policy `pullup-learnings-v1`)

| kind | evidence | suggested edit |
|---|---|---|
| over-escalation | for one question in one folder (first two path segments): ≥ 8 pull requests where PullUp's ask was **sent**, ≥ 70 % `ask-unneeded`, at least 15 points above the repo's baseline, and no `ask-useful` in the last 30 days | `severity.questionLevels.<question> = "p2"` (loosens: typed confirm) |
| confirmed-pattern | ≥ 5 pull requests, ≥ 60 % `ask-useful` or `changes-addressed` | raise the question to P0 (or a hint when it already is) |
| missed-risk | ≥ 2 overridden approvals in a folder in 30 days | a scoped rule: no auto-approve for that folder |
| review-guidance | ≥ 5 useful asks in a folder in 90 days | a template sentence the owner may copy into the review focus (no edit) |

Logged-only asks never count toward over-escalation: in Evaluation, humans
never saw PullUp's ask. A dismissed learning (append-only
`learning_dismissals`) is suggested again only once its support doubles.
Folder names with unexpected characters are dropped (file names are pull
request content).

## Surfaces

- Dashboard **Outcomes** page: tiles, learnings (Dismiss · Open as draft),
  outcomes by finding, recent decisions. "Open as draft" applies the edits to
  the Settings draft and pre-fills the change note; nothing is saved until you
  save.
- `GET /api/repos/:o/:r/outcomes` (no writes), `POST …/learnings/:id/dismiss`.
- `pullup outcomes <repoId> [--since 90] [--json]`.
- The Eve agent's `triage_pull` adds `repoHistory`: up to three matching
  learnings as a `<repo_history trust="derived-data">` block of counts and
  identifiers. It may shape the explanation, never the action.
