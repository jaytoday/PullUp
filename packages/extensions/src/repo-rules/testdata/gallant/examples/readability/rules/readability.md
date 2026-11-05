---
appliesTo: "*.go"
type: score
criteria:
  - "Easy to read"
  - "Somewhat hard to read"
  - "Very hard to read"
violation:
  if:
    "Somewhat hard to read": 0.5
    "Very hard to read": 0.5
---
# Readability

Rate how hard this file is to read.

Think about what a reader has to hold in their head as they go:

- **Naming** — are identifiers specific and honest, or vague filler like
  `data`, `process`, `handle`, `doStuff`?
- **Structure** — is the control flow easy to follow, or deeply nested?
- **Size** — are functions short and focused, or long and doing several things?
- **Surprises** — hidden side effects, dense one-liners, or unexplained magic
  numbers.

Then pick a level:

- `Easy to read` — a newcomer could follow it without effort.
- `Somewhat hard to read` — parts are dense or nested; it takes study.
- `Very hard to read` — tangled control flow or dense logic throughout.
