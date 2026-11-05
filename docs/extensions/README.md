# Extensions

Everything PullUp looks for comes from an **extension**: a small module bundled with PullUp (never
loaded from a repository or the internet) that looks at a run and may raise questions, pick who to
ask, or add notes for the reviewer. ([Back to the overview](../README.md))

## The extensions

| Extension | What it does | Default |
| --- | --- | --- |
| [`core`](core.md) | The built-in checks: a test that passed only on a rerun, weakened tests, changes to code that is hard to undo. | On (Active) |
| [`repo-rules`](repo-rules.md) | The repository's own rules (Gallant rule files in `.pullup/rules/`), checked per changed file. | Off |
| [`threat-model`](threat-model.md) | Checks each change against the repository's `THREATS.md`. | Off |
| [`codeowners`](codeowners.md) | Asks the code owners of the files a question is about. | Off |
| [`inert`](inert.md) | Checks an author's claim that a change is switched off behind a feature flag; asks a person when a flag is turned on. | Off |
| [`doc-links`](doc-links.md) | Links design docs and walkthroughs for the reviewer. Notes only. | Off |

## Modes

Each extension is switched in the repository's config, or in Settings → Extensions:

- **Off**: skipped.
- **Shadow**: try it out. Its questions are shown as "would ask" and sent to the council (so the
  Accuracy page can show what it would have done), but they never change the result and no one is
  asked.
- **Active**: its questions count.

A newly listed extension starts in Shadow, so switching one on is always safe.

## Rules every extension keeps

PullUp's extension **host** (`packages/engine/src/host.ts`) enforces these, so no extension has to:

1. **Code decides.** Extensions cannot reach the network, the database or the clock. If one needs a
   model's judgment it asks the host for a [screen](screens.md).
2. **Extensions only add work.** They can raise questions, but never pass, drop or soften another
   extension's question. One that crashes raises a question only a person may pass: nothing checked
   is not a pass.
3. **Loosening is explicit.** Settings that make PullUp pass more easily need "loosen" typed.
4. **Rules come from the default branch**, including which extensions are on.
5. **Notes never change a result.**
6. **Everything is on the record**: each extension's version and output is kept with the decision.
7. **Only the host sends anything**, through the governed sender.

Too many questions are folded or sent straight to a person, never dropped: at most `maxQuestions` per
extension (default 3) and `council.maxQuestionsPerRun` per run (default 6).

### The one way a question gets easier

The host keeps a short, fixed list of **relaxations**. Today there is one: the council may pass a
question alone. An extension can propose it (for example `inert`, for a change verified to be
switched off). The host applies it only when the proposing extension is Active, a setting marked as a
loosening is on, it declares that it depends on the target's extension, and the target is not on the
never-relax list (threat model questions other than new entry points, turning a flag on, an extension
that failed). Every applied or refused relaxation is recorded and shown.

## More

- [Writing an extension](writing-an-extension.md)
- [Screens: cheap model checks](screens.md)
- `pnpm pullup extensions` and `GET /api/extensions` list every extension's settings and defaults.

## Not built yet

- **Continuous review** (some questions settled after merge, before the change is exposed): needs new
  GitHub App events (`pull_request` closed, `push`) and a decision on where follow-ups appear.
- **The threat model's operator contract check**: reading branch protection needs the GitHub App's
  Administration read permission.
- **A "Continuous" starting set** in setup, which waits for continuous review.
