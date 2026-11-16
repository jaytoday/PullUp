# The decision step

Back to the [overview](README.md). Code: `src/server/decide/`.

One function, `askMergeRisk(input)`, sits behind the agent's `assess` tool. `PULLUP_DECIDER` picks the provider:

| `PULLUP_DECIDER` | Calls | Notes |
|---|---|---|
| `jev` | Jev's System One API at `JEV_BASE_URL` (`jev.ts`, about 40 lines) | The baseline. Pointing `JEV_BASE_URL` at `{askwithai}/v1/runtimes/{owner}/ci-review` with an AskWithAI key is adoption step 1. |
| `gemini` | The Gemini Decisions API at `GEMINI_DECISIONS_BASE_URL` (`gemini.ts`) | The other baseline; the same swap works through AskWithAI's Gemini endpoint. |
| `askwithai` | `createDecision` from `@askwithai/sdk` (`askwithai.ts`) | Typed answers, person reviews, input requests and outcomes. `escalateIf: blastRadius > 200`. |

The two baseline clients stay in the repository so a reader can see exactly what "before" looked like. Both send the same question as `askwithai/runtime.yaml` (`MERGE_RISK` in `types.ts`): AskWithAI's compatible endpoints match questions by key or exact wording. When the base address points at AskWithAI, the response's `AskWithAI-Decision-Id` header is kept, so outcomes can be reported even before moving to the SDK.

Every call has an idempotency key (`pullup:<run>:<concern>`), and an error becomes a failed assessment, never an answer. The serving mode (parity, shadow, active) is switched in AskWithAI, not in PullUp.

## The input

`concern`, `repository`, `headSha`, `title`, `body` (cut at 2,000 characters), `evidence[]` (`source`, `where`, `text`), `blastRadius` (changed lines in sensitive paths, capped at 500) and `diffTruncated` (`packages/engine/src/assess-input.ts`).
