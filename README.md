# PullUp

A continuous integration (CI) check for pull requests, built as an app on WithAI's public API.

Each run ends one of three ways:

1. **Hard failure → fail.** A required job failed and failed again on rerun. No AI is called.
2. **Nothing tricky → pass.** No trigger fired. No AI is called.
3. **Something tricky → ask the council.** A few AI reviewers (WithAI "seats") answer typed
   questions. A fixed rule in code turns their answers into pass, fail, or "ask a person".

Status: being built. See `docs/how-it-works.md` once it exists.
