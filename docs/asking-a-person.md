# Asking a person

Back to the [overview](README.md). Code: `src/server/pipeline.ts` (`answerFromGithub`, `refreshWaiting`).

AskWithAI owns reviews. When the runtime's person tier is worth its price (a wrong answer would cost more than asking), the decision is `pending_review` and the concern waits. PullUp's check then says "Waiting for a person" (in Enforce mode it stays in progress with **Pass** and **Fail** buttons).

A reviewer can answer in three places:

- **PullUp's `/reviews`** (or AskWithAI's Reviews page): the web kit's keyboard queue. 1 or 2 picks `risky` or `safe`, `r` focuses the reason, Enter settles.
- **The GitHub check's Pass or Fail button.**
- **A pull request comment:** `/pullup pass <reason>` or `/pullup fail <reason>`.

A GitHub answer counts only from a login in the config's `reviewers` list or a repository admin. It settles every open AskWithAI review on the run with the person's label (Fail means `risky`, Pass means `safe`). A concern with no AskWithAI review (a baseline provider, or a failed call) takes the answer directly, and the answer is reported as an outcome when the decision has an AskWithAI id. A person's `risky` fails the concern without a quote.

The worker re-reads every waiting decision each minute, so an answer given in AskWithAI, or a deadline that passed, updates the check.

## Input requests

A decision can also wait for a **fact** (an input request): for example, "Is the failing test on the repository's known-flaky list?" The agent calls `answer_input_request`; PullUp computes the answer from `.pullup/config.json` and sends it, and the decision resumes. Facts PullUp cannot compute stay in the review queue for a person. A fact is used for that decision only; it never becomes a label.
