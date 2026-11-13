# Screens: cheap model checks

([Back to extensions](README.md))

Some checks need a model's judgment ("does this change break rule X?", "with every flag off, does
anything differ?"). Extensions never call a model themselves. Instead:

1. An extension returns **screen requests** from `screens(ctx)`: a question, the file it is about,
   guidance text (such as the rule), and the possible answers.
2. The host asks each one through the configured AskWithAI screen runtime, all in parallel, at most
   `screens.maxPerRun` per run (default 20). The repository's text is sent as data, not instructions.
3. The host **checks every answer**: it must be one of the allowed answers, and an answer that reports
   a problem must quote a changed line that really is in the file.
4. The extension receives the checked answers in `ctx.screens` during `detect`.

Anything that could not be checked (a failed call, a wrong answer, a problem with no valid quote, over
the limit, or no AskWithAI screen runtime configured) comes back as **not checked**. The extension must turn that into a
note or a question, never a pass.

`pullup check --record` saves screen answers next to the review decisions, and `--replay` reuses them,
so a run can be repeated without calling AskWithAI.

## Measured live

Historical result from 2026-11-05 (the former WithAI cheap tier): a "no debugging code" rule on an added `console.log` was answered
"yes" (0.95) with the exact line, and the review then failed the run with checked quotes, in about
10 seconds in all. A clean change was answered "no" three times out of three.
