# Adopting AskWithAI, step by step

Back to the [overview](README.md).

This runbook takes PullUp from calling Jev directly to running on AskWithAI, in six steps. It is written for a developer who has a working agent that calls a decision model and has never used AskWithAI. Every step can be undone ([rolling back](#rolling-back)).

## Before you start

- PullUp in its baseline: `PULLUP_DECIDER=jev`, with `JEV_BASE_URL` and `JEV_API_KEY` for Jev, in `.env.local`. To follow along without GitHub or keys, also set `PULLUP_DEMO=1` (synthetic pull requests on a fake GitHub; see [demo mode](demo.md)).
- A local AskWithAI: in its checkout, `pnpm dev` (port 3700, embedded database, demo mode needs no model keys). Sign up, then create an API key under Settings → API keys.
- Ten minutes.

## Step 1. Describe the decision as a package (5 minutes)

PullUp's question was already in code: one yes-or-no question per concern, "Is this change risky to merge?" (`MERGE_RISK` in `src/server/decide/types.ts`). The same question, with its labels, mistake costs and tiers, is in `askwithai/runtime.yaml`, and the rubric files in `askwithai/rubrics/` are the domain-expert prompt ([the package](decision-package.md)).

```bash
export ASKWITHAI_URL=http://localhost:3700 ASKWITHAI_API_KEY=wai_...   # also in .env.local
npx askwithai push askwithai --runtime <you>/ci-review                   # creates the runtime
npx askwithai mode <you>/ci-review parity
npx askwithai check askwithai --runtime <you>/ci-review                  # the release gates
```

Or, in the AskWithAI studio, **New runtime → Use template → CI review (PullUp)**: the same package plus its 369 synthetic test cases, so **Evaluate** works straight away. What you get: a runtime page in AskWithAI.

## Step 2. Swap the base address (2 lines)

```diff
-JEV_BASE_URL=https://api.typesafe.ai
-JEV_API_KEY=<your Jev key>
+JEV_BASE_URL=http://localhost:3700/v1/runtimes/<you>/ci-review
+JEV_API_KEY=wai_...
```

Nothing else changes: PullUp's Jev client (`src/server/decide/jev.ts`) sends the same request. The runtime is in **parity**: it answers with its fast tier's own answer, unchanged, and records the decision. Play a batch (in demo mode, **Play 10 pull requests** on `/quality`), then open AskWithAI's runtime **Decisions** tab: the same answers, now with receipts, latency and cost. PullUp keeps the `AskWithAI-Decision-Id` header on each assessment (see the run page).

**Checking parity.** `pnpm test` includes the automated check with recorded responses. With a real Jev key, `pnpm parity` sends 50 cases directly twice and once through AskWithAI and reports the agreement rates and the added latency ([demo mode](demo.md#pnpm-parity)).

## Step 3. Watch in shadow (no code)

```bash
npx askwithai mode <you>/ci-review shadow
```

(or the serving-mode control on PullUp's `/quality` once step 4 connects the screens). Callers still get the same answers; AskWithAI also runs full routing in the background and records what it would have answered. Play the next batch and read the **shadow comparison**: agreement, cost per 1,000 served and routed, and, once outcomes arrive, realized loss of each.

Go on when routine cases agree, routing's expected loss is lower on the disagreements, and the routed cost is under your limit. If not, stay in shadow and go to step 6.

## Step 4. Move to the SDK (about 20 lines)

```diff
-PULLUP_DECIDER=jev
+PULLUP_DECIDER=askwithai
+PULLUP_RUNTIME=<you>/ci-review
```

The SDK path is `src/server/decide/askwithai.ts`:

```ts
const schema = z.object({ merge_risk: z.enum(["risky", "safe"]) });
const decide = createDecision(client, { runtime, schema, escalateIf: (c) => c.blastRadius > 200 });
const r = await decide(input, { traceId: headSha, requestId, idempotencyKey: requestId });
```

What it adds: typed answers, a trace per commit, person reviews and input requests (`pending_review`, `input_required`), and outcomes. PullUp reports outcomes in `src/server/outcomes.ts` with one call:

```ts
await client.reportOutcome(decisionId, { labels: { merge_risk: "safe" }, key: `pullup:merged:${runId}:${concern}` });
```

**The collaboration screens** are three kit components behind one route (shown in full):

```ts
// src/app/api/askwithai/[...path]/route.ts (simplified)
export const { GET, POST, PATCH } = createAskWithAIHandler({
  apiKey: process.env.ASKWITHAI_API_KEY!,
  runtimes: [process.env.PULLUP_RUNTIME!],
  authorize: async (req) => !!(await auth.api.getSession({ headers: req.headers })),
});
```

```tsx
<AskWithAIProvider endpoint="/api/askwithai">  {/* src/components/providers.tsx */}
<DecisionFeed runtime={runtime} />            {/* /decisions */}
<ReviewQueue runtime={runtime} />             {/* /reviews */}
<QualityPanel runtime={runtime} />            {/* /quality, with ShadowComparison and ServingModeControl */}
```

The SDK comes from npm (`@askwithai/sdk`). The private kit is a vendored tarball in `vendor/`; `ASKWITHAI_REPO=<checkout> pnpm askwithai:sync` repacks it.

## Step 5. Go active

On `/quality`, choose **Active** and confirm (or `npx askwithai mode <you>/ci-review active`). What changes for PullUp: answers are routed, so some concerns come back `pending_review` (a reviewer should look) or `input_required` (a fact is missing). PullUp's rule keeps those runs waiting; in **Enforce** mode the check stays in progress. The agent answers facts it can find in the repository (the known-flaky list); the rest wait in `/reviews`.

Answer two reviews in `/reviews` from the keyboard (1 or 2, then Enter). A reviewer can also press Pass or Fail on the GitHub check, or comment `/pullup pass` or `/pullup fail` ([asking a person](asking-a-person.md)).

## Step 6. Improve

- **Outcomes** fill the quality panel (in demo mode: **Report outcomes**). AskWithAI's benchmarks and calibration use them (see AskWithAI's calibration docs).
- **Change a rubric**, then:

```bash
npx askwithai push askwithai --runtime <you>/ci-review --note "known-issue retries"
npx askwithai replay --runtime <you>/ci-review --version 2 --against live --since 24h
```

Read the changed cases, and promote in AskWithAI if the release gates pass. AskWithAI's **Learning** tab can also propose rules and notes from settled cases.
- Read the quality panel before and after; AskWithAI's mission control charts each version.

## Use it from Claude Code

Point a coding agent at `http://localhost:3700/SKILL.md`: it explains how to push the package, switch modes and read decisions with the `askwithai` command, and AskWithAI's MCP server (`/api/mcp`) exposes the same as tools.

## Outcomes without code

The package's `connectors:` entry turns GitHub events into outcomes inside AskWithAI: labeling a pull request `pullup:reverted` marks every decision for its head commit `risky`. Add a GitHub webhook for `pull_request` events pointing at the connector's address on the runtime's Overview tab ([outcomes](outcomes.md)).

## Rolling back

At any step: set the serving mode back to `parity`, or point `JEV_BASE_URL` back at Jev (and `PULLUP_DECIDER=jev`). Both are instant and lose no records already made.

## Troubleshooting

| Error | Fix |
|---|---|
| 401 or 403 | The key is wrong or lacks a scope: PullUp needs `decide`, `decisions:read`, `outcomes:write` and `reviews`; `askwithai push` and `mode` also need `runtimes:read` and `runtimes:write`. |
| 422, "input does not match the schema" | The message names the field; `assessInput` and `runtime.yaml`'s `inputSchema` must agree (a test checks this). |
| 422, unknown question | A compatible endpoint matched no question: the instructions must be exactly the runtime's prompt. |
| `verify()` mismatch | The SDK schema's labels (`risky`, `safe`) must match the runtime's question. |
| "replay found no cases" | Decisions made without retained inputs cannot be replayed; keep `retainInputs: true` or use the template's test cases. |
