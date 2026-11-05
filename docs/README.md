# PullUp, in one page

PullUp is a check on pull requests. After your tests and other automated checks (your "CI") finish,
PullUp looks at the results and the change, and posts one check on GitHub called **PullUp** that says
pass or fail.

Most of the time it decides on its own, with plain code:

- **Something really broke** (a required test failed, even after a retry) → **fail**.
- **Nothing looks tricky** → **pass**.

Only when something needs judgment (a test that passed only on a second try, deleted tests, a change
to sign-in code…) does it ask for help:

1. A small panel of AI reviewers (the **council**) looks at the question. Each must back up a "fail"
   with an exact quote from the change.
2. A fixed rule in code turns their answers into pass, fail, or "a person should decide".
3. If a person should decide, PullUp asks them (by email, phone or WithAI) and waits for their answer.

Everything PullUp decides and sends is written to a tamper-evident record.

## Three ideas that keep it safe

- **Code decides, AI advises.** The AI reviewers never pass or fail anything directly; code applies the
  rule to what they said.
- **Start quiet.** Every repository starts in **Shadow mode**: the check never blocks a merge and only
  says what PullUp *would* decide. The owner switches it to **Active** when they trust it.
- **Rules live in the repository**, in `.pullup/config.json` on the default branch, so a pull request
  cannot loosen the checks it is judged by.

## What it looks for: extensions

Each kind of check is an **extension** you switch Off, to Shadow (try it out) or Active: the built-in
checks, the repository's own rules, a threat model, picking the right people to ask, a check that a
change is switched off behind a feature flag, and links for the reviewer.
See [Extensions](extensions/README.md).

## Read more

| Topic | Document |
| --- | --- |
| A run from start to finish, step by step | [How a run works](how-a-run-works.md) |
| Who is asked, how they answer, what happens with no answer | [Asking a person](asking-a-person.md) |
| How PullUp sends to GitHub safely, and the record it keeps | [Safety and the record](safety-and-records.md) |
| What PullUp itself protects against, and where in the code | [PullUp's threat model](threat-model.md) |
| The `.pullup/config.json` file | [Configuration](configuration.md) |
| The dashboard's pages | [The dashboard](dashboard.md) |
| Extensions: what they are, each one, writing one | [Extensions](extensions/README.md) |
| How the code is organised | [Code layout](code-layout.md) |
| Running it locally, setting up GitHub, tests and checks | [Running and testing](running-and-testing.md) |
