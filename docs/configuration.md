# PullUp — configuration

PullUp's CI gate is configured per repo from the dashboard (**Settings** in a
repo's sidebar), from `pullup.config.json`, or both. Everything the UI shows is
one validated config shape (`configFileSchema` in `@pullup/core`), so the CLI,
the Eve agent, the server and the browser all agree.

## Layers

```
defaults  <  pullup.config.json (file)  <  repo settings version (DB, per repo)
```

- **File** is optional and applies to every repo. Its path is itself a locked
  "Review & bot config" category, so a PR can't rewrite the rules it's judged by.
- **Repo settings** are append-only versions in `repo_config_versions`
  (note, author, loosened fields, hash). Restoring an old version creates a new
  one. Saves use optimistic concurrency: a stale `baseVersion` returns 409.
- **Presets** (Conservative / Balanced / Fast lane — Ask / Show / Ship) are never
  applied implicitly: picking one writes its values into the repo layer and
  records `preset` as a marker ("Based on Balanced · 2 changes").
- Every report and logged action records the config version and a sha256 of the
  canonical effective config (`configProvenance`, `configVersion`).

## Mode: what PullUp may send

Each decision has its own authority level:

| level | on GitHub |
|---|---|
| `off` | nothing (recorded as `suppressed`, still shown in the dashboard) |
| `comment` | one PullUp comment per PR, edited in place (`<!-- pullup:decision -->` marker): "PullUp would approve this PR…" |
| `act` | the real action: APPROVE / REQUEST_CHANGES review, or request reviewers + comment |

Named modes (`actions` in config):

| mode | approve | requestChanges | requestHuman |
|---|---|---|---|
| Off | off | off | off |
| **Evaluation** (default) | comment | comment | comment |
| Block only | comment | act | act |
| Full | act | act | act |

Any other combination is **Custom**. "Approves but never blocks" is allowed but
flagged and counts as loosening. **Approve · Act is clamped to comment** until
the repo's fast-path calibration gate passes *and* a live actuator exists (none
in this build). Authority only changes what is sent — decisions, bands, `w*` and
guardrails are identical at every level (tested), so Evaluation is a faithful
rehearsal of Full.

The Jev layer's own switch (`jev.mode`: `off` / `shadow` / `active`) is shown as
**Signals: Off · Observe · Use in decisions**. It controls whether risk signals
change decisions, not what is sent.

## GitHub check (`checks`)

```json
"checks": { "enabled": false, "name": "PullUp", "blockOn": "never", "annotations": true }
```

- `enabled` posts one check run per commit with the decision and findings
  (see `docs/github.md` for the conclusion table). It adds output only.
- `blockOn`: `never` (default) or `request-changes`. The check fails only when
  PullUp requests changes **at Act**. Moving it back to `never` counts as
  loosening (typed confirm). Asking a human never fails the check.
- `name` is what branch protection requires; renaming it breaks those rules.
- `annotations` pins located findings to diff lines.

## Inline finding comments (`inline`)

```json
"inline": { "enabled": false, "reportOn": "p1", "includeObserve": false,
            "maxComments": 10, "resolveFixed": true, "maxResolutions": 20 }
```

Located risk-signal findings at `reportOn` or more severe become inline review
comments, and PullUp resolves its own thread when a later push makes the
finding go away (`docs/github.md`). Information only: every field is neutral
for loosening because none of them changes a decision or an action.
`includeObserve` also posts findings while signals are only observed. The
comments ride on PullUp's action for the pull request; a pull request with no
action (for example still inside its wait window with nothing to flag) gets none.

## Walkthrough links (`walkthroughs`)

```json
"walkthroughs": { "enabled": true, "paths": ["specs/**/*.md", "specs/**/*.mdx"], "maxLinks": 3 }
```

When a pull request changes a walkthrough file (a Markdown spec that explains
the change, such as the "living specs" the [diffmap](https://github.com/tanishqkancharla/diffmap)
agent skill writes in `specs/`), PullUp's comment links to it so the reviewer
can start there (`docs/github.md`). On by default. Information only: every
field is neutral for loosening, nothing reads the file's contents, and a
walkthrough never changes a decision, a finding or an action. Like inline
comments, the link rides on PullUp's action for the pull request.

## Evidence check (`verify`)

```json
"verify": { "enabled": false, "model": "claude-opus-5", "maxPerPull": 3, "inObserve": false, "budgetUsdPerDay": 5 }
```

A second, read-only pass on the risk-signal findings that could change an
action: built-in questions at P0 or P1, active (or observed with `inObserve`),
at most `maxPerPull` per pull request, never on a pull request where the
injection tripwire fired. It runs only when asked (`pullup verify`, or "Check
evidence" on a pull request) and is cached by finding, hunk contents and
verifier version.

- **The live verifier** (`@pullup/verify`) is a Claude tool loop with three
  read-only tools over the repo at the head commit (read a file, list a
  directory, search code) and a `submit_verdict` tool. It sees the question
  that fired and the finding's hunks with line numbers, never the pull
  request's title, body or comments. Server-side refusal fallbacks are on; a
  refusal or error is `unsure` and is not cached. Without `ANTHROPIC_API_KEY`
  the deterministic synthetic verifier is used.
- **Checked in core** (`verify/accept.ts`): a `confirmed` verdict is accepted
  only if every quote is an added or removed line of the finding's own hunks
  at the stated path and line (±3), and the fix and reason pass the free-text
  screen. Otherwise it is downgraded to `unsure`.
- **Raise-only:** with `severity.signalsCanRequestChanges: "verified"`, an
  accepted confirmed P0/P1 signal finding may request changes; every other
  verdict leaves the finding asking a human. A verdict never removes a finding,
  lowers a level, changes a recommendation or `w*`, or enables an approval.
  Confirmed evidence is quoted in the decision comment, inline comments and
  check annotations.
- `budgetUsdPerDay` stops live calls once the day's recorded spend reaches it.

## Guardrails (the approval envelope)

`guardrails` runs in every Jev mode. Two outcomes:

- **requireHuman** → escalate now (category hits).
- **approveBlocker** → PullUp may not approve; once `w*` passes it asks a human
  instead (`source: "guardrail"`).

| setting | effect |
|---|---|
| `maxAutoApproveLines` (0–1000, step 50, `null` = no limit) | lines changed, excluding `sizeExcludeGlobs` (lockfiles, vendor, dist, snapshots) when their patch is measurable |
| `maxAutoApproveFiles` (1–50, `null`) | files changed, same exclusions |
| `requireHumanCategories` | CI workflows · review & bot config · new dependencies · first-time contributors are **locked on** (schema rejects `false`); infrastructure, migrations, auth, secrets, Dockerfiles, major dependency bumps are toggles |
| `tiers.low` / `tiers.high`, `approveMaxTier` | tiers trivial (docs/test allowlist) < low < standard < high < critical (category + `policy.requireHumanGlobs`); above `approveMaxTier` blocks approval |
| `dependencies.autoApprove` | `patch|minor` × `dev|runtime` kinds the bot may approve (parsed from package.json hunks) |
| `dependencies.minReleaseAgeDays` | stored, **not enforced** (needs registry metadata) |
| `tests.requireForBehaviorChange` / `tests.testOnlyFastPath` | production code without a test change is a P1 rule finding (see severity); test-only PRs count as trivial |
| `authors.aiAuthors`, `aiSizeMultiplier`, `trustedBots` | AI-authored (login glob or `ai-generated` label) PRs get stricter size limits; trusted bots skip the first-time rule |
| `freezeWindows` | nothing is auto-approved inside a window |

With guardrails, `policy.requireHumanGlobs` are **extra** critical paths on top of
the enabled categories (without guardrails — the bare core API — they replace
the defaults as before).

## Findings and severity (P0 / P1 / P2)

Every reason PullUp might act is a **finding** with a level and a source
(`rule` = deterministic, `signal` = Jev / custom question):

| level | today's sources | options (default in bold) |
|---|---|---|
| P0 blocking | escalating Jev question at ≥ `sensitiveHigh` (auth, secrets, validation, schema); injection tripwire | **Request changes** · Ask a human |
| P1 important | other sensitive signals at ≥ medium; a P0 question below high; unevaluated code; tests missing (rule); change worth less than it costs (rule) | Request changes · **Ask a human** · Note only |
| P2 minor | questions an owner set to P2 | Ask a human · **Note only** |

- `severity.actions` holds one choice per level. `severity.questionLevels`
  re-levels questions; custom questions cap at P1, and lowering a level counts
  as loosening.
- **Signals can't request changes** unless `severity.signalsCanRequestChanges`
  is set; otherwise they ask a human. If the injection tripwire fires, none of
  the PR's signals can request changes.
- The most severe finding decides: request changes, then ask a human (together
  with guardrail categories and escalations), then the cost model, whose
  approvals still respect blockers.
- Signal findings only count in "Use in decisions" (`jev.mode: active`). In
  Observe they're shown as "observe only".
- A PR a human has already approved or requested changes on is left alone.
- Size, tier and freeze limits stay **approval blockers**, not findings.
  "Always require a human" categories stay escalations.
- PullUp's comment groups findings by level with Conventional-Comments labels.
- The defaults reproduce the pre-severity actions, with one exception: a change
  worth less than it costs used to request changes and now asks a human (P1).
- Presets set the P1 row: Conservative = Request changes, Balanced = Ask a
  human, Fast lane = Note only.

## Special cases (scoped rules)

`rules` are optional per-folder / per-author / per-label adjustments on top of
the repo policy:

```json
{ "name": "Billing", "when": { "paths": ["src/billing/**"] },
  "set": { "requireHuman": true, "severity": { "p1": "request-changes" }, "reviewers": ["billing-team"] } }
```

- **Conditions:** `paths` (with `pathMatch` `any` (default) or `all`),
  `authors` (login globs) and `labels`. Every condition given must match.
- **Effects:** `requireHuman`, `noAutoApprove`, `requireTests`, `maxLines`,
  `maxFiles`, `severity` (per level) and `reviewers` (added to the request).
- **Safety:** a rule matched through `pathMatch: any` can only make things
  **stricter**. Only rules with `pathMatch: all`, or scoped purely by author or
  label, may loosen, and adding one counts as loosening (typed confirm).
  Removing a rule that tightened also counts as loosening.
- **Combining:** base, then loosen-capable rules in list order (later wins),
  then stricter-only rules (strictest value per field).
- The PR sheet shows which rules applied. The preview counts the open and
  recent merged PRs each rule matches, and warns about rules that match nothing.
- Templates: Stricter folder, Trusted author, New or AI authors, Docs-only PRs.

## Free text and prompt injection

Only two fields accept prose; neither can choose an action (the engine picks
actions from typed outputs):

- `review.focus` (≤ 280 chars, ≤ 4 lines) → given to the Eve rationale writer
  inside `<repo_review_focus trust="owner-config">…</repo_review_focus>` via
  `triage_pull`, with instructions to treat it as data. Never shown to Jev.
- `jev.customQuestions` (≤ 3, fragment ≤ 120 chars after the fixed prefix
  "Does this code … ?") → Jev noul questions that are **raise-only**: a yes at
  `sensitiveMedium` routes to the review band; they never escalate, never enable
  the fast path, carry no risk weight. They re-version the question set
  (`q-v1+c<fnv>`), which invalidates the answer cache and any calibration.

Both are NFKC-normalised and **rejected** (not silently stripped) on invisible
or bidi characters, look-alike letters, HTML comments/tags, code fences, URLs,
encoded blobs, role markers, slash commands, and phrase-level instructions
(approve this, skip checks, don't escalate, treat as safe…). The same
`screenFreeText` runs in the browser (live) and in the schema (server).
Built-in questions can be switched off (`jev.disabledQuestions`, a loosening
change); the injection tripwire can't.

## Loosening and the save flow

`config/fields.ts` registers every leaf with a `loosens` direction (higher /
lower / false / true / grow / shrink / rank / neutral). The save dialog lists
each change as **loosens** or **tightens**; any loosening requires typing the
repo name (server: 409 `needsConfirm` without `confirmLoosen`).

**Preview** (`POST …/config/preview`) replays the draft against cached data only:
open-PR actions before → after (with flipped PRs), and for the last 300 merged
PRs how many fall inside the approval envelope, plus the defect-proxy rate of
newly eligible PRs vs baseline.

## API

| method | path |
|---|---|
| GET | `/api/repos/:o/:r/config` — effective, file, repo layers, sources, version, approval lock |
| GET | `/api/repos/:o/:r/config/versions` — newest first, each with its diff |
| POST | `/api/repos/:o/:r/config/validate` `{config}` |
| POST | `/api/repos/:o/:r/config/preview` `{config}` |
| POST | `/api/repos/:o/:r/config` `{config, note, baseVersion, confirmLoosen?}` |
| POST | `/api/repos/:o/:r/config/restore/:v` `{baseVersion, confirmLoosen?}` |
| GET | `/api/repos/:o/:r/stats/sizes` — merged-PR sizes, counted like the guardrail |
| POST | `/api/repos/:o/:r/questions/try` `{text, pullNumber?}` — one custom question on one PR (model call, uncached) |

CLI: `pullup config --repo owner/repo` prints the layered config; `report`,
`analyze`, `actions`, `signals` and `calibrate` all use the repo layer.
