# How a run works

One commit, from a finished workflow to the PullUp check. ([Back to the overview](README.md))

1. **A workflow finishes.** GitHub tells PullUp (a signed message called a webhook). PullUp checks the
   signature, handles each message once, and opens the run for that commit (or reopens it after a rerun).
2. **Read the config** from `.pullup/config.json` on the repository's **default branch**, never from the
   pull request. No config → the run is marked as an error and nothing is posted.
   ([Configuration](configuration.md))
3. **Collect.** Once every workflow listed in `requiredWorkflows` has finished, PullUp reads:
   - each job's attempts (a rerun is a second attempt) and the end of each failed attempt's log;
   - failing test names, from JUnit report files in a `pullup-reports` artifact, if there is one;
   - the pull request's diff, title, description, labels and author;
   - files that switched-on extensions ask for (for example `THREATS.md`). If reading them fails, the
     last good copy is used and the run says so.

   A required workflow still unfinished after an hour counts as missing.
4. **Optional rerun.** With `flaky.rerun` on, a required workflow that failed on its first attempt is
   rerun once, and PullUp waits for it.
5. **Hard failures.** A required job that failed on every attempt, or failed once on a test not on the
   known-flaky list, or a required workflow that never ran → **fail**. No AI is called.
6. **Extensions look for what needs judgment.** Each switched-on extension may raise **questions**,
   each with exact evidence (lines of the diff, log text). Some first ask the host for a cheap model
   check (a **screen**). No question → **pass**, with no AI call.
   ([Extensions](extensions/README.md))
7. **AskWithAI.** For each question, PullUp sends a bounded, idempotent request to its configured
   Decision Runtime ([The AskWithAI connection](askwithai-connection.md)). The runtime returns a fixed
   label, probability, reason, and citations. A failed, synthetic, late, or malformed response counts
   as "needs a person".
8. **The quote check.** A quote counts only if it really is in what it names (a changed line, a log).
   A "fail" with no quote that checks out counts as "needs a person".
9. **The resolution rule**, per question:
   - a "fail" with a valid quote → the question **fails**;
   - a sufficiently strong "pass", and the question allows the runtime to pass it → it **passes**;
   - otherwise → **ask a person** ([Asking a person](asking-a-person.md)).
10. **The run's result:** any failed question → fail; any question waiting for a person → waiting;
    otherwise pass. Questions from extensions in Shadow mode are shown but never count.
11. **The check.** One check called "PullUp" on the commit, sent through PullUp's governed sender
    ([Safety and the record](safety-and-records.md)).

## Shadow mode and Active mode

- **Shadow** (every repository starts here): the check is always neutral (it never blocks a merge),
  titled "Shadow: would pass / fail / ask a person". No one is asked anything.
- **Active**: the check passes or fails. A run that needs a person stays "in progress" with Pass and
  Fail buttons until it is settled. The owner switches a repository to Active in Settings by typing
  its name.

Extensions have their own Shadow mode too, so one new check can be tried while the rest of the
repository is Active.
