# Writing an extension

([Back to extensions](README.md))

An extension is one folder in `packages/extensions/src/<id>/` and one line in
`packages/extensions/src/registry.ts`. It may import only `@pullup/sdk`, `zod` and its own files.

```ts
import { defineExtension } from "@pullup/sdk";
import { z } from "zod";

export default defineExtension({
  id: "my-check",               // also the config key and the start of its question ids
  version: "1.0.0",             // bump when behavior changes; recorded with every output
  title: "My check",
  summary: "One plain sentence for the extensions list.",
  config: {
    schema: z.object({ strict: z.boolean().default(true) }),   // every setting needs a default
    fields: [{ key: "strict", label: "Strict", help: "…", kind: "boolean", loosens: true }],
  },
  reads: (config) => [{ from: "default", globs: ["MY-RULES.md"] }],   // files the host reads for you
  detect(ctx) {
    return { questions: [{ key: "x", prompt: "…?", summary: "…", evidence: [], councilMayPass: false }] };
  },
});
```

## What `ctx` holds

`config` (this extension's settings), `run` (jobs and attempts), `diff` (parsed, with line numbers and
git's function headings), `pull` (title, description, labels, author, or null), `files` (from
`reads`), `facts` (from extensions listed in `needs`), `screens` (checked answers to this extension's
[screens](screens.md)), `shared` (required workflows, known flaky tests) and `now`.

## The optional parts

| Part | Use it to |
| --- | --- |
| `detect` | Raise questions (with evidence), publish facts for other extensions, add file and line findings, propose a relaxation. |
| `notes` | Add help for the reviewer. Never changes a result. |
| `screens` | Ask the host for cheap model checks before `detect`. |
| `recipients` | Name who to ask about a question (first extension to name someone wins). |
| `personForLogin` | Say which person a GitHub login stands for, so their button presses count. |
| `needs` | List extensions whose facts it reads; they run first. |
| `relaxations` | Declare the relaxation it may propose and the setting that switches it on. |
| `loosenings` | Describe its looser-than-default settings in words (otherwise the fields marked `loosens` are used). |

Setting fields drive the form in Settings: `kind` is `boolean`, `number`, `text`, `list`, `choice` or
`map`; mark `loosens: true` on any setting that can make PullUp pass more easily.

## Testing it

- Unit tests next to the code; `packages/extensions/src/test-context.ts` builds a `ctx`.
- Fixtures in `fixtures/` (a config, a recorded run, and the expected question ids in
  `expect.questions`) are run by the engine's tests automatically.
- The engine's tests also check every bundled extension against the shared rules (notes never change
  a result, purity of imports, settings that match the schema).
