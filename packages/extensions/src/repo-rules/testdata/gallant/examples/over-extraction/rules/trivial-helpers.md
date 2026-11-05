---
appliesTo: "*.go"
type: noul
minConfidence: 0.7
---
Does this file violate the following rule?

# Do not wrap trivial checks in their own function

Splitting out a pure core is worth it when the core holds logic a reader has to
follow. Wrapping a single trivial expression in a named function adds a lookup
without adding understanding, and applying "functional core, imperative shell"
to every condition turns a function into a scavenger hunt.

Report a violation when the file defines helper functions whose whole body is a
single trivial expression or check, such as a nil test, a length test, a
comparison, or a field read, where a caller would be clearer reading that
expression directly.

A helper is not a violation when it holds several steps, when it names a real
domain concept the file is about rather than restating its implementation, or
when several places use it to keep one definition.

Judge the file as a whole.
