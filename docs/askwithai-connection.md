# The AskWithAI connection

([Back to the overview](README.md))

PullUp is a software-engineering application built on the AskWithAI Decision Runtime platform. PullUp gathers repository and CI evidence, chooses when a pull request needs judgment, verifies returned citations, and controls the GitHub check. AskWithAI runs the configured, versioned decision runtime, chooses how much model reasoning a question needs, and records the decision and its later outcome.

## What each product owns

| PullUp | AskWithAI |
|---|---|
| GitHub App, pull-request lifecycle, CI results, diffs, repository configuration, and extensions | Versioned Decision Runtimes, model and provider routing, calibration, cost-sensitive escalation, and decision records |
| Deterministic CI failure rules and merge enforcement | Decision labels, probabilities, routing receipts, and model-proposed citations |
| Independent quote verification against changed lines, job logs, and report evidence | Outcome records used to evaluate runtime decisions |
| Shadow and Active modes, human notifications, and the final GitHub check | Optional native person-review workflows when configured by a runtime owner |

AskWithAI does not need GitHub concepts. PullUp remains useful without model calls: hard CI failures and runs with no questions are decided locally. AskWithAI answers are advisory until PullUp checks them and applies its own resolution rules.

## Decision API calls

For each review question that needs model judgment, PullUp sends a bounded input to the configured review runtime. The input includes the repository and commit identifiers, the question, relevant evidence, bounded job summaries, and a capped diff with a `diffTruncated` flag. Each job attempt includes `logsTruncated` when the shared 20,000-character log limit cut the excerpt. PullUp sends one decision request per question with a stable idempotency key, a run trace identifier, and a step name. The runtime reference and pinned version come from deployment environment settings; pull-request configuration cannot select a secret or change the runtime version.

The review runtime's input schema must accept `repository`, `pullRequest`, `headSha`, `questionId`, `extension`, `prompt`, `summary`, `extensionContext`, `viewpoints`, `evidence`, `jobs`, `diff`, and `diffTruncated`. PullUp's configured review viewpoints are context for the runtime; AskWithAI still owns model selection and any model council. `pullRequest` may be null; otherwise it has `number`, `title`, `body`, `labels`, and `author`. `jobs` contains workflow and job names with bounded attempts, failed-test names, log excerpts, and `logsTruncated` flags.

Extension screens use the configured screen runtime. PullUp sends the screen question, its allowed results, guidance, and changed code. The runtime returns one of the fixed `option_1` through `option_8` labels, which PullUp maps back to the screen's repository-defined result.

The screen runtime input schema must accept `repository`, `pullRequest`, `headSha`, `screenId`, `question`, `guidance`, `allowedResults`, and `changedCode`. Each allowed result pairs a fixed label such as `option_1` with the repository-defined result string. Screens with more than eight allowed results are marked not checked without a model call.

The runtime must be configured to match these contracts:

- The review runtime uses one stable question key, with labels `pass`, `fail`, and `needs_person`.
- The screen runtime uses one stable question key, with labels `option_1` through `option_8`.
- Do not configure AskWithAI's native person-review tier yet. PullUp currently owns the human question and answer lifecycle; a native pending review would create a second review owner.
- The runtime input schema accepts the fields PullUp sends. It should not retain raw inputs unless the owner explicitly chooses that policy.
- Each deployed runtime version is pinned in PullUp's environment and changed deliberately. Both the runtime reference and positive version number are required before PullUp calls it.

`PULLUP_ASKWITHAI_MODE` defaults to `shadow`. In repositories already marked Active, this means AskWithAI is not allowed to settle review questions or screens; those questions go to the existing person-needed path. AskWithAI can produce comparison decisions when the repository itself is in PullUp Shadow mode. Set `PULLUP_ASKWITHAI_MODE=active` only after PullUp-specific evaluation supports enforcement. PullUp Shadow repositories remain non-blocking regardless of this setting.

AskWithAI returns citations under the question receipt. They are model-proposed text, not verified evidence. PullUp accepts a `fail` only when a citation names a supported source and its quote matches the collected source; otherwise it downgrades the answer to "a person should decide". Missing responses, synthetic responses, unsupported labels, timeouts, and API errors never become a pass.

The Decision API's 0–1 probability is mapped to PullUp's existing 1–5 strength scale: 5 at 0.95 or above, 4 at 0.85 or above, 3 at 0.70 or above, 2 at 0.55 or above, and 1 below that. PullUp's configured pass-strength threshold and per-question `councilMayPass` rule still apply.

## Human decisions and outcomes

PullUp's existing human-answer path remains in place during this migration. A real person's pass or fail ruling is reported to AskWithAI against the runtime decision and question key, using an idempotency key. Model agreement and synthetic answers are never reported as outcomes. AskWithAI's native review tier is not yet the owner of PullUp's human-notification lifecycle.

PullUp records the AskWithAI decision identifier, runtime, version, status, and usage alongside the checked answer. Its tamper-evident evidence record and GitHub sender remain authoritative for what PullUp did.

## Configuration

Set these server-side environment variables:

| Variable | Purpose |
|---|---|
| `ASKWITHAI_API_KEY` | AskWithAI API key with `decide` and `outcomes:write` scopes |
| `ASKWITHAI_URL` | Optional Decision API base URL; defaults to the hosted API |
| `PULLUP_ASKWITHAI_MODE` | `shadow` by default; `active` is the explicit switch allowing runtime results to settle Active checks |
| `PULLUP_REVIEW_RUNTIME` | Owner and slug of the configured review runtime |
| `PULLUP_REVIEW_VERSION` | Required pinned review runtime version |
| `PULLUP_REVIEW_ANSWER_KEY` | Optional runtime question key; otherwise PullUp uses the first answer |
| `PULLUP_SCREEN_RUNTIME` | Screen runtime, required to enable extension screens |
| `PULLUP_SCREEN_VERSION` | Required pinned screen runtime version |
| `PULLUP_SCREEN_ANSWER_KEY` | Optional screen question key; otherwise PullUp uses the first answer |

The separate `WITHAI_URL`, `WITHAI_TOKEN`, and `WITHAI_WEBHOOK_SECRET` settings are temporarily retained only for the existing email, phone, or member notifications. They no longer make review or extension-screen decisions and can be removed after human notification and review ownership are migrated.

## Privacy and rollout

AskWithAI's default is not to retain raw inputs. Its current durable decision receipt can retain model-proposed citations even with input retention disabled; this is disclosed in the platform API documentation and tracked separately as [JAM-79](https://linear.app/jams-projects/issue/JAM-79/expire-decision-citations-when-inputs-are-not-retained). PullUp must still send only the bounded context needed for the decision.

Keep PullUp in Shadow mode while collecting comparisons and real outcomes. AskWithAI's current public evaluation has not met its adversarial hard-split criterion with the default escalation model, and PullUp-specific real outcomes are not yet sufficient to justify changing enforcement. PullUp's global stop switch and repository modes remain authoritative.
