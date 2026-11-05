# `doc-links`: links for the reviewer

([Back to extensions](README.md))

Notes only: it never changes a result.

- **Design docs** in `docs/designs/` that mention a changed file are linked.
- **Walkthrough specs** in `specs/` that the change edits (diffmap's living specs) are linked.

Links are pinned to the commit PullUp decided on. File names are written by the pull request's author,
so only plain names (letters, digits, `.`, `_`, `-`) are named or linked.

Settings: `designDocs` (default `docs/designs`), `specs` (default `specs`), `maxLinks` (default 3).
