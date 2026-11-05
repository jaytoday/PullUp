# `codeowners`: asking the right people

([Back to extensions](README.md))

Reads `CODEOWNERS` (`.github/CODEOWNERS`, `CODEOWNERS` or `docs/CODEOWNERS`, as GitHub does) from the
default branch. For each question, it asks the owners of the files the question's evidence points at,
instead of the one person in `ask.to`. The last matching line wins, as on GitHub.

GitHub logins and teams are mapped to people PullUp can reach through WithAI:

```json
"codeowners": { "mode": "active", "people": { "@alice": "alice@example.com", "@acme/payments": "payments@example.com" }, "maxPeople": 2 }
```

Email owners in CODEOWNERS are used as they are. An owner with no mapping is skipped (a note lists
them); a question with no mapped owner goes to `ask.to`. A mapped owner's Pass / Fail on GitHub counts
as their answer. It never adds or changes a question. ([Asking a person](../asking-a-person.md))
