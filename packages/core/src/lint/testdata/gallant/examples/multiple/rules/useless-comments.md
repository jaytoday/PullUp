---
appliesTo: "*.go"
type: noul
---
Does this file violate the following rule?

# Useless comments

A comment should explain something the code cannot: the intent behind a choice,
a constraint, or a non-obvious detail. A comment that only restates what the
code plainly does adds nothing and drifts out of sync as the code changes:

```go
i++          // increment i
return total // return total
```

Ignore tooling directives such as `//go:generate` and `//nolint`. Report a
violation when the file contains comments that merely repeat the code.
