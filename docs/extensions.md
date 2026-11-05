# Extensions

PullUp's core is a small pipeline: CI results → hard failure → questions → a council of AI seats →
the resolution rule → ask a person → one "PullUp" check. Everything that raises a question, picks
who to ask, or adds help for the reviewer is an **extension**: a TypeScript module bundled with
PullUp, in its own folder under `packages/extensions/src/<id>/`, with its own config section, tests
and docs. Extensions are never loaded from a repository or the internet.

## The bundled extensions

| Id | What it does | Default |
| --- | --- | --- |
| `core` | The three built-in checks: a test that passed only on a rerun, weakened tests, changes to sensitive paths. | Active (on unless switched off) |
| `repo-rules` | The repository's own rules: Gallant lint rule files in `.pullup/rules/` on the default branch, each checked per changed file with a cheap model screen. A file that could not be checked is a question (`failClosed`). | Off |
| `threat-model` | Checks each change against the repository's threat model (`THREATS.md`): controls touched, code map drift, new entry points, edits that weaken the model. Plain code, no model calls. | Off |
| `codeowners` | Asks the code owners of a question's files (from `CODEOWNERS`) instead of `ask.to`. | Off |
| `doc-links` | Links design docs that mention a changed file and walkthrough specs the change edits. Notes only. | Off |

`pnpm pullup extensions` and `GET /api/extensions` list them with every setting, its default and
whether it loosens PullUp.

## Turning extensions on: modes

Each extension has a mode in the repository's `.pullup/config.json` (read from the default branch):

- **Off**: skipped.
- **Shadow**: its questions are shown as "would ask" on the check and the run page, and are sent to
  the council so the accuracy page can show what it would have done, but they never change the
  result and no one is asked. `shadowCouncil: false` keeps them away from the council (no cost).
- **Active**: its questions count like any other.

`core` is Active unless the config says otherwise. Every other extension is off unless listed, and a
listed extension with no `mode` starts in **Shadow**, so turning one on is safe. The repository's
own Shadow mode (Settings) still makes the whole check neutral.

```json
{
  "requiredWorkflows": ["ci"],
  "ask": { "to": "reviewer@example.com", "perExtension": { "threat-model": "fail" } },
  "extensions": {
    "core": { "sensitivePaths": { "extraGlobs": ["infra/**"] } },
    "threat-model": { "mode": "shadow", "path": "THREATS.md" },
    "codeowners": { "mode": "active", "people": { "@alice": "alice@example.com" } },
    "doc-links": { "mode": "active" }
  }
}
```

Older configs keep working: top-level `triggers` and `sensitivePaths` are read into
`extensions.core`, and `ask.perTrigger` into `ask.perExtension` as `core:<trigger>`.

Every section also takes `maxQuestions` (default 3): more questions from one extension in one run are
folded into one question that lists them. `council.maxQuestionsPerRun` (default 6) caps how many
questions go to the council in one run (Active first, then those only a person may pass); the rest go
straight to a person. Nothing is ever dropped.

In the dashboard, **Settings → Extensions** lists every extension per repository with its mode and a
settings form. PullUp never writes to a repository: changes are saved as a draft of the file, which
the owner commits to the default branch. A change that loosens PullUp needs "loosen" typed first.
The setup page offers two starting sets: **Essentials** (core) and **Security** (core, threat model,
code owners; the new ones in Shadow).

## Rules every extension keeps

The host (`packages/engine/src/host.ts`) enforces these, so no extension has to remember them:

1. **Code decides.** Extensions are pure: no network, no clock (the host passes `now`), no
   randomness, no database. A test (`packages/extensions/src/imports.test.ts`) allows them no
   imports but `@pullup/sdk`, `zod` and their own files.
2. **Extensions only add work.** They return questions, facts, notes, annotations and relaxation
   requests; anything else is ignored. They see frozen copies of the run, so one cannot change what
   the next sees. An extension that throws or returns a bad shape raises a question only a person may
   pass ("nothing checked is not a pass"). The run's result is combined in a fixed order: hard
   failure > a failed question > an open question > pass.
3. **Loosening is explicit.** Settings that make PullUp pass more easily are marked `loosens` and
   listed by `loosenings()`; the settings and setup pages ask for a typed confirmation.
4. **Config comes from the default branch**, including which extensions are on.
5. **Notes never change a result** (tested for every bundled extension on every fixture).
6. **Every output is on the record**: each extension's id, version, mode and a hash of its output are
   in the decision, with a composition hash of all enabled extensions and their settings.
7. **No extension writes to GitHub or WithAI.** The host plans the writes and sends them through the
   governed sender.

### Relaxations: the only way a question gets easier

The host owns a short fixed list of ways to make one question easier. Today there is one,
`council-may-pass` (the council may pass the question alone). An extension proposes it in its
output; the host applies it only when the proposing extension is Active, a boolean setting it declares
(marked `loosens`) is on, it lists the target's extension in `needs`, and the target is not on the
never-relax list (threat model questions other than new entry points, turning a flag on, an extension
that failed, and any question marked `neverRelax`). Every applied or refused relaxation is recorded
and shown. New kinds are a change to the host, never to an extension.

## Writing an extension

```ts
import { defineExtension } from "@pullup/sdk";
import { z } from "zod";

export default defineExtension({
  id: "my-check",               // also the config key and the question id prefix
  version: "1.0.0",             // bump with behavior; recorded on every output
  title: "My check",
  summary: "One plain sentence for the extensions list.",
  config: {
    schema: z.object({ strict: z.boolean().default(true) }),   // every field needs a default
    fields: [{ key: "strict", label: "Strict", help: "…", kind: "boolean", loosens: true }],
  },
  reads: (config) => [{ from: "default", globs: ["MY-RULES.md"] }],   // files the host reads for you
  detect(ctx) {
    // ctx: config, run, diff (parsed), pull (title, body, labels, author), files, facts, shared, now
    return { questions: [{ key: "x", prompt: "…?", summary: "…", evidence: [], councilMayPass: false }] };
  },
});
```

Optional parts: `notes` (reviewer help), `recipients` (who to ask about a question), `personForLogin`
(a GitHub login → the person it stands for), `needs` (extensions whose facts it reads; they run first),
`relaxations`, `loosenings`. Add the folder, one line in `packages/extensions/src/registry.ts`, unit
tests next to it (`test-context.ts` builds a run context), and fixtures in `fixtures/` (the fixture
test checks the question ids in `expect.questions`).

## Screens: cheap model checks

An extension that needs a model's judgment (for example `repo-rules`: "does this change break rule
X?") never calls the model. It returns screen requests from `screens(ctx)`; the host asks them through
WithAI `apply` on the cheap tier, one call each, in parallel, at most `screens.maxPerRun` (default 20)
per run, and hands back checked answers in `ctx.screens`. An answer counts only if it is one of the
screen's options and, when it reports a problem, quotes a changed line that really is in the file. A
failed call, a bad answer, a problem with no valid quote or a screen over the limit comes back as
`not-checked`, which the extension must turn into a note or a question. `pullup check --record` and
`--replay` cover screens as well as the council's seats.

Measured live (2026-11-05, WithAI's cheap tier): a `no-debug` rule on an added `console.log` was
answered "yes" (0.95) with the exact line, and the council then failed the run with checked quotes
(about 10 seconds in all); a clean change was answered "no" three times out of three.

## Repository rules

`repo-rules` reads Gallant's rule format unchanged (`appliesTo` file-name globs, `type` noul /
choice / score, `criteria`, `violation`, `minConfidence`), so the same folder works for a developer
running Gallant before a push. A glob with a folder part (`**/*.ts`) is refused with the reason, since
Gallant matches file names only. Two PullUp-only fields: `pullupLevel` (p1 / p2, a label) and
`pullupCouncilMayPass: false` (a person decides that rule). A rule that fails raises one question
`repo-rules:<rule>` with the quoted lines and the rule text as the council's context.

## The threat model file

`threat-model` reads a file in the layout of the Warden DNS resolver's public `SECURITY.md`:

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

The headings may sit inside a larger file at any level. In the Code column, several references are
separated by `;`. Entry points in backticks are file globs (a new file matching one) or, when they
contain `(` or no `/`, `*` or `.`, code that an added line contains.

| Check | Fires when | A person decides? |
| --- | --- | --- |
| Control touched (`T3`) | A changed line is in a mapped file, inside the named function when one is given (from git's hunk heading or the line itself) | Yes, unless `controlsCouncilMayPass` |
| Code map drift (`drift-T3`) | The change deletes or renames a mapped file, or removes the mapped function | Yes |
| New entry point (`entry-point`) | An added file or line matches an entry point and no threat maps that file | No (the council may pass it) |
| Threat model weakened (`model-weakened`) | The change removes a threat, moves one out of scope, drops a contract item, or makes the file unreadable | Yes |

A missing or unreadable threat model is a note on every run, never a silent pass. PullUp's own threat
model is `docs/threat-model.md`; `packages/engine/src/threat-model-self.test.ts` checks its code map
against the code, so moving a control without updating the map fails the tests.

## Not built yet

Planned, in this order:

- **`inert` and `continuous-review`** (phase 5): need new GitHub App events and an owner decision on
  where follow-ups appear.
- **The daily threat model check** (operator contract and code map drift on the default branch):
  `codeMapProblems()` exists; the worker job and reading branch protection (needs the App's
  Administration read permission) do not.
- **The Continuous setup preset** waits for `inert` and `continuous-review`.
