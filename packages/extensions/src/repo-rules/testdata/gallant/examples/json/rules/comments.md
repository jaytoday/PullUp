---
appliesTo: "*.go"
type: choice
criteria:
  useful: "The comments mostly explain intent, rationale, or non-obvious details."
  mixed: "Some comments add value, others only repeat the code."
  useless: "The comments mostly restate what the code already says."
violation:
  if:
    useless: 0.5
---
# Comments

Classify the comments in this file.

A good comment explains *why*: the intent behind a choice, a constraint that is
not obvious from the code, a subtle gotcha, or where to look next. It tells the
reader something the code itself cannot.

A comment that only restates *what* the code plainly does is noise. It adds
nothing, and it drifts out of sync as the code changes:

```go
i++          // increment i
return total // return total
lock()       // acquire the lock
```

Ignore comments that are pure tooling directives (build tags, `//go:generate`,
`//nolint`). Judge the remaining comments as a whole:

- `useful` — they mostly explain intent or rationale.
- `mixed` — some add value, others only repeat the code.
- `useless` — they mostly restate what the code already says.
