# How a run works

Back to the [overview](README.md). Code: `src/server/pipeline.ts`.

1. **A required workflow finishes.** GitHub sends a `workflow_run` webhook. PullUp opens (or reopens) the run for that commit.
2. **The config** is read from `.pullup/config.json` on the default branch, never from the pull request.
3. **Collection.** Once every required workflow finished (or after an hour, deciding without the missing ones and saying so), PullUp collects each job's attempts, the end of each failed attempt's log, failing test names from JUnit reports, and the pull request's diff, title and body (`packages/github/src/collect.ts`).
4. **Hard failures.** A required job that failed on every attempt, or failed on tests not on the known-flaky list, fails the run. A required workflow that never ran, or skipped everything, fails too. No model call.
5. **Concerns.** The three detectors run (`packages/engine/src/concerns.ts`). None fired → pass, no model call.
6. **The agent** investigates and assesses each concern ([The agent](the-agent.md)). Each `assess` call is one decision ([The decision step](decision-step.md)), with the head commit as its trace id.
7. **The fixed rule** (`packages/engine/src/policy.ts`) turns the assessments into pass, fail or "wait for a person". Quotes in a `risky` answer are checked against the change and the logs first.
8. **The check run** is posted through the governed sender ([Safety](safety-and-records.md)). In Enforce mode a waiting run stays in progress with Pass and Fail buttons.
9. **Later:** the worker re-reads waiting decisions every minute (a reviewer may have answered in AskWithAI), settles the run when something changed, and reports outcomes ([Outcomes](outcomes.md)).

Every step is written to the run's record. The run page shows the CI, each concern with its answer and the rule's reading, and the agent's steps.
