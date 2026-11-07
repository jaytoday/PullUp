# Asking a person

Only in Active mode, and only for questions the council could not settle.
([Back to the overview](README.md))

## Who is asked

- By default, `ask.to` in the config: an email address, a phone number in international format, or a
  WithAI member id. `ask.toGithub` is their GitHub login, so their clicks on GitHub count as theirs.
- An extension can name better people for a question: the `codeowners` extension asks the owners of
  the files the question is about. If several people are asked, any of them may answer.

## How they answer

Any one of these:

- the message WithAI sends them;
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
| `follow-council` | Pass if most reviewers said pass and no "fail" held up, otherwise fail. A question only a person may pass always fails. |
| `pass` | The question passes, marked "passed without an answer". |
| `escalate` | Ask `ask.backup` with a fresh deadline; if they do not answer either, `ask.onNoAnswerAfterBackup` applies. |

An answer that arrives late still counts and replaces the no-answer outcome.

## Learning from answers

Each question is linked to the workspace's "CI policy" skill in WithAI, with the run attached. People's
answers become that skill's examples, so the AI reviewers' guidance improves over time. The Accuracy
page in the dashboard shows how often the council agreed with people ([The dashboard](dashboard.md)), and PullUp reports each seat's outcome back to WithAI ([The WithAI connection](withai-connection.md)).
