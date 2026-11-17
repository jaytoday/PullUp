# PullUp, in one page

PullUp decides whether a pull request's CI result is safe to merge, and posts one GitHub check called **PullUp**.

Most of the time plain code decides:

- **Something really broke** (a required test failed on every attempt) → **fail**.
- **Nothing looks tricky** → **pass**.

When something needs judgment, code flags a **concern**:

| Concern | Flagged when |
|---|---|
| Flaky retry | A required test failed, then passed on a rerun |
| Deleted or weakened tests | Tests were deleted, skipped, or their assertions loosened |
| Sensitive change | The change touches sign-in, permissions, payments, migrations or CI configuration |

A small **agent** then investigates: it reads the logs, the diff or a file, and calls one tool, `assess`, per concern. `assess` asks a **decision runtime** (Jev, the Gemini Decisions API, or AskWithAI) whether the concern is `risky` or `safe`. PullUp's **fixed rule** turns the typed answers into the check: `risky` with a quote that really appears in the change fails, `safe` passes, and anything unsure waits for a reviewer. A model never decides the check by its own text.

## Three ideas that keep it safe

- **Code decides, the runtime advises.** The agent's tools are bounded, the check comes from typed answers only, and an adverse answer needs a checked quote.
- **Start quiet.** Every repository starts in **Report only**: the check never blocks a merge and says what PullUp would do. **Enforce** makes it pass, fail, or wait for a person, and never passes on simulated answers.
- **Rules live in the repository**, in `.pullup/config.json` on the default branch, so a pull request cannot loosen its own checks.

## The AskWithAI story

PullUp starts as an ordinary app calling Jev directly. It adopts AskWithAI in steps: change the base address (same answers, now recorded), watch in shadow, then go active, where routine concerns get cheap answers and a reasoning model or a reviewer looks only where a wrong "safe" is expensive. Outcomes (merged and kept, or reverted) flow back so AskWithAI can measure and improve the runtime.

## Read more

| Topic | Document |
|---|---|
| **Start here**: running both apps and watching a decision happen | [Quick start](quick-start.md) |
| Adopting AskWithAI, step by step (the runbook) | [Adopting AskWithAI](adopting-askwithai.md) |
| A run from start to finish | [How a run works](how-a-run-works.md) |
| The agent: tools, guardrails, harnesses | [The agent](the-agent.md) |
| The decision step and the provider swap | [The decision step](decision-step.md) |
| The `ci-review` decision package | [The decision package](decision-package.md) |
| Reviews, input requests and GitHub answers | [Asking a person](asking-a-person.md) |
| Outcomes reported to AskWithAI | [Outcomes](outcomes.md) |
| The screens | [Screens](screens.md) |
| `.pullup/config.json` and environment variables | [Configuration](configuration.md) |
| Demo mode, synthetic data and the comparison | [Demo mode](demo.md) |
| Comparison results (simulated) | [Results](results.md) |
| The governed sender and the tamper-evident record | [Safety and the record](safety-and-records.md) |
| How the code is organised | [Code layout](code-layout.md) |
| Running it locally, GitHub setup, tests | [Running and testing](running-and-testing.md) |
