---
appliesTo: "*.msg"
type: noul
---
Does this commit message violate the following rule?

# Commit messages say what and why

A commit message should let someone who was not there understand the change
without reading the diff. Write the subject in the imperative mood, as if it
completed "This commit will …", and give the reason in the body when the change
alone does not make it obvious.

Judge the message you are shown:

- **Violates** — the subject only names a file or a vague area ("fix stuff",
  "more parser work") instead of saying what changed.
- **Violates** — the body restates the subject, or lists what changed without
  saying what any of it was for.
- **Does not violate** — a precise imperative subject, with a body that gives the
  reason when the change needs one.
- **Does not violate** — a short message when the change is small and the subject
  already states it exactly.
