---
appliesTo: "*.md"
type: choice
criteria:
  compliant: "The document follows the rule."
  violation: "The document breaks the rule."
violation:
  if:
    violation: 0.5
---
# Headings step down one level

Judge whether the document keeps its heading levels in order. A heading must not
skip a level, for example an `h3` directly after an `h1`.
