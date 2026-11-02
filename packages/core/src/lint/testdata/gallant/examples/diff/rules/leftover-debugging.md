---
appliesTo: "*.go"
type: noul
---
Does this file violate the following rule?

# No debugging leftovers

A change should not carry debugging scaffolding: a print added to trace a value,
commented-out code kept in case it is needed, or a marker left behind while
working. None of it belongs in the code, and none of it explains itself to the
reader who finds it later.

Judge the code you are shown:

- **Violates** — tracing such as `fmt.Println`, `println`, or `log.Printf` used
  to inspect a value rather than to report an event the program cares about.
- **Violates** — a `panic` called to dump a value, rather than to handle a real
  error.
- **Violates** — commented-out code, or a `TODO`, `FIXME`, or `XXX` with no owner
  and no issue to point at.
- **Does not violate** — logging that is the intended behavior of the code, with
  a level and a message a reader would want.
- **Does not violate** — a `TODO` that names an owner or a tracking issue.
