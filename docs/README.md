# PullUp, in one page

PullUp is the pull-request decision system built on the AskWithAI Decision Runtime platform. After
your tests and other automated checks (your "CI") finish, PullUp looks at the results and the
change, and posts one check on GitHub called **PullUp** that says pass or fail. PullUp supplies
software-engineering context and merge policy; AskWithAI supplies versioned decision runtimes,
model routing, receipts, and outcome tracking.

Most of the time it decides on its own, with plain code:

- **Something really broke** (a required test failed, even after a retry) → **fail**.
- **Nothing looks tricky** → **pass**.

Only when something needs judgment (a test that passed only on a second try, deleted tests, a change
to sign-in code…) does it ask for help:

1. PullUp sends only questions that need judgment to a configured AskWithAI runtime. The runtime
   applies its versioned policy and returns a decision receipt with supporting citations.
2. PullUp checks any adverse citation against the changed lines, job logs, or report evidence. Its
   fixed rule turns the checked answer into pass, fail, or "a person should decide".
3. If a person should decide, PullUp asks them through its configured notification path or GitHub and waits for their answer.

Everything PullUp decides and sends is written to a tamper-evident record.

## Three ideas that keep it safe

- **Code decides, AskWithAI advises.** The runtime never passes or fails anything directly; code applies the
  rule to what they said. AskWithAI's result cannot bypass PullUp's evidence checks or merge policy.
- **Start quiet.** Every repository starts in **Shadow mode**: the check never blocks a merge and only
  says what PullUp *would* decide. The owner switches it to **Active** when they trust it.
- **Rules live in the repository**, in `.pullup/config.json` on the default branch, so a pull request
  cannot loosen the checks it is judged by.

## What it looks for: extensions

Each kind of check is an **extension** you switch Off, to Shadow (try it out) or Active: the built-in
checks, the repository's own rules, a threat model, picking the right people to ask, a check that a
change is switched off behind a feature flag, and links for the reviewer.
See [Extensions](extensions/README.md).

PullUp uses AskWithAI's [Decision API](askwithai-connection.md) for review and extension-screen
decisions. Model calls remain optional: hard CI failures and runs with no questions are resolved in
PullUp without calling the platform. The current migration keeps the separate legacy WithAI
notification path for sending human questions while PullUp moves those decisions to AskWithAI.

## Read more

| Topic | Document |
| --- | --- |
| A run from start to finish, step by step | [How a run works](how-a-run-works.md) |
| Who is asked, how they answer, what happens with no answer | [Asking a person](asking-a-person.md) |
| How PullUp uses AskWithAI runtimes, receipts, and outcomes | [The AskWithAI connection](askwithai-connection.md) |
| How PullUp sends to GitHub safely, and the record it keeps | [Safety and the record](safety-and-records.md) |
| What PullUp itself protects against, and where in the code | [PullUp's threat model](threat-model.md) |
| The `.pullup/config.json` file | [Configuration](configuration.md) |
| The dashboard's pages | [The dashboard](dashboard.md) |
| Extensions: what they are, each one, writing one | [Extensions](extensions/README.md) |
| How the code is organised | [Code layout](code-layout.md) |
| Running it locally, setting up GitHub, tests and checks | [Running and testing](running-and-testing.md) |
