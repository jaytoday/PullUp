# Asking a person

Only in Active mode, and only for questions the AskWithAI runtime could not settle.
([Back to the overview](README.md))

## Who is asked

- By default, `ask.to` in the config: an email address, a phone number in international format, or a
  WithAI member id. `ask.toGithub` is their GitHub login, so their clicks on GitHub count as theirs.
- An extension can name better people for a question: the `codeowners` extension asks the owners of
  the files the question is about. If several people are asked, any of them may answer.

## How they answer

Any one of these:

- the email, phone, or member message sent through the temporary legacy WithAI notification service;
- the **Pass** / **Fail** buttons on the PullUp check on GitHub;
- a pull request comment starting `/pullup pass <reason>` or `/pullup fail <reason>`.

Only the people asked, or a repository admin, can answer. The first answer wins; the other messages
are withdrawn. A button or comment answers every waiting question of that run.

## When no one answers

One reminder at half the deadline (`ask.remind`). At the deadline (`ask.deadlineMinutes`, default 240)
the **no-answer option** applies. It is looked up in this order: `ask.perExtension` for the question
(`core:flaky-test`), then for its extension (`threat-model`), then `ask.onNoAnswer`.

| Option | At the deadline |
| --- | --- |
| `fail` (default) | The question fails: "No answer from …". |
| `follow-council` | Follow the prior model answers if they were mostly pass and no verified fail held up; otherwise fail. A question only a person may pass always fails. |
| `pass` | The question passes, marked "passed without an answer". |
| `escalate` | Ask `ask.backup` with a fresh deadline; if they do not answer either, `ask.onNoAnswerAfterBackup` applies. |

An answer that arrives late still counts and replaces the no-answer outcome.

## Learning from answers

Email, phone, and WithAI-member notifications still use the legacy WithAI question service during the migration. GitHub buttons and `/pullup` comments remain available independently. When a person answers a question backed by an AskWithAI decision, PullUp reports that person's pass or fail label to the matching AskWithAI decision and runtime question. It does not turn model agreement into an outcome. See [The AskWithAI connection](askwithai-connection.md) for ownership and migration status.
