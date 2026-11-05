---
appliesTo: "*.go"
type: choice
criteria:
  clear: "Names say what a value holds or what a function does."
  mixed: "Some names are clear, and some are filler."
  vague: "Names are mostly filler such as data, process, handle, or doStuff."
violation:
  if:
    vague: 0.5
---
# Naming

Judge the names in this file.

A name should tell a reader what a value holds or what a function does. Filler
names such as `data`, `process`, `handle`, `result`, or `doStuff` say nothing, so
a reader has to trace the code to learn what they mean:

```go
func handle(data []byte) error { ... }
var result = process(data)
```

Ignore names fixed from outside the file, such as an interface method or a JSON
field name. Pick the option that describes the file as a whole.
