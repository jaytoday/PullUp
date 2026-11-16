import { readFileSync, writeFileSync } from "node:fs";
import { AskWithAIError } from "@askwithai/sdk";
import { parse, stringify } from "yaml";
import { askwithaiClient, runtimeRef } from "@/server/decide/askwithai";
import { MERGE_RISK } from "@/server/decide/types";
import { readPackage } from "./package-files";

/**
 * `pnpm demo:compare`: the holdout and hard splits of askwithai/tests/cases.jsonl
 * through three configurations, written to docs/results.md:
 *
 *   Decision model only            the fast tier's own answer (parity)
 *   Reasoning model on everything  a runtime whose only tier is the reasoning model
 *   AskWithAI routed               fast tier first, escalation by expected loss, no person tier (a fair comparison)
 *
 * The configurations are two helper runtimes made from PullUp's package
 * (`<owner>/ci-review-compare`, `<owner>/ci-review-reasoning`), called through
 * the System One compatible endpoint. At most 200 cases per split. On demo
 * engines every number is simulated, and the page says so.
 */

const MAX_PER_SPLIT = 200;

/** AskWithAI allows 600 requests a minute per key: pace the calls, and wait out a 429. */
async function politely(call: () => Promise<Response>): Promise<Response> {
  for (let i = 0; ; i++) {
    await new Promise((r) => setTimeout(r, 110));
    const res = await call();
    if (res.status !== 429 || i >= 3) return res;
    await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after") ?? 60) * 1000));
  }
}
const env = process.env;

interface Case {
  id: string;
  input: Record<string, unknown> & { blastRadius: number };
  labels: { merge_risk: "risky" | "safe" };
  split: string;
}

/** The runtime's mistake costs: a wrong "safe" costs 25 + 2 × blast radius, a wrong "risky" costs 4. */
const loss = (answer: string, truth: string, blast: number) => (answer === truth ? 0 : answer === "safe" ? 25 + 2 * blast : 4);

async function ensureRuntime(client: NonNullable<ReturnType<typeof askwithaiClient>>, ref: string, slug: string, tiers: (t: Array<{ kind: string }>) => unknown[]) {
  const files = readPackage("askwithai");
  const doc = parse(files["runtime.yaml"]!) as { metadata: Record<string, unknown>; spec: { tiers: Array<{ kind: string }> } };
  doc.metadata.slug = slug;
  doc.metadata.name = `PullUp CI review (${slug})`;
  doc.spec.tiers = tiers(doc.spec.tiers) as never;
  delete files["tests/cases.jsonl"];
  files["runtime.yaml"] = stringify(doc);
  try {
    await client.getRuntime(ref);
    const v = await client.push(ref, files, { note: "demo:compare configuration" });
    await client.request("POST", `/v1/runtimes/${ref}/versions/${v.version.number}/promote`, { overrideReason: "Comparison configuration for pnpm demo:compare." }).catch(() => undefined);
  } catch (e) {
    if (!(e instanceof AskWithAIError) || e.status !== 404) throw e;
    await client.push(ref, files, { name: doc.metadata.name as string });
  }
  await client.setServingMode(ref, "active");
}

async function main() {
  const client = askwithaiClient(env);
  const owner = runtimeRef(env).split("/")[0];
  if (!client || !owner) throw new Error("Set ASKWITHAI_URL, ASKWITHAI_API_KEY and PULLUP_RUNTIME first.");
  const base = (env.ASKWITHAI_URL ?? "http://localhost:3700").replace(/\/+$/, "");
  const routed = `${owner}/ci-review-compare`;
  const reasoning = `${owner}/ci-review-reasoning`;
  await ensureRuntime(client, routed, "ci-review-compare", (t) => t.filter((x) => x.kind !== "person"));
  await ensureRuntime(client, reasoning, "ci-review-reasoning", (t) => t.filter((x) => x.kind === "reasoning").map((x) => ({ ...x, id: "reasoning" })));

  const cases = readFileSync("askwithai/tests/cases.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l) as Case);
  const configs = [
    { name: "Decision model only", runtime: routed, serving: "parity" },
    { name: "Reasoning model on everything", runtime: reasoning, serving: undefined },
    { name: "AskWithAI routed", runtime: routed, serving: undefined },
  ];
  const rows: string[] = [];
  let synthetic = false;
  for (const split of ["holdout", "hard"]) {
    const list = cases.filter((c) => c.split === split).slice(0, MAX_PER_SPLIT);
    for (const cfg of configs) {
      let correct = 0, lossSum = 0, cost = 0, costUnknown = false, escalated = 0, latency = 0;
      for (const c of list) {
        const res = await politely(() => fetch(`${base}/v1/runtimes/${cfg.runtime}/v1/systemone`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${env.ASKWITHAI_API_KEY}`, ...(cfg.serving ? { "AskWithAI-Serving": cfg.serving } : {}) },
          body: JSON.stringify({ model: "compare", state: c.input, questions: { q0: { type: "noul", instructions: MERGE_RISK.instructions, criteria: { true: MERGE_RISK.risky, false: MERGE_RISK.safe } } } }),
        }));
        const body = (await res.json()) as { answers?: { q0?: { noul?: number } }; askwithai?: { decision_id: string; path?: string; cost_usd: number | null; latency_ms: number; synthetic: boolean } };
        if (!res.ok || typeof body.answers?.q0?.noul !== "number") throw new Error(`${cfg.name}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
        const answer = body.answers.q0.noul >= 0.5 ? "risky" : "safe";
        if (answer === c.labels.merge_risk) correct++;
        lossSum += loss(answer, c.labels.merge_risk, c.input.blastRadius);
        if (body.askwithai?.cost_usd === null) costUnknown = true;
        cost += body.askwithai?.cost_usd ?? 0;
        latency += body.askwithai?.latency_ms ?? 0;
        synthetic ||= !!body.askwithai?.synthetic;
        const path = body.askwithai?.path ?? (body.askwithai ? (await client.getDecision(body.askwithai.decision_id)).path : "fast_only");
        if (path !== "fast_only" && path !== "rules" && path !== "precedent") escalated++;
      }
      const n = list.length;
      rows.push(`| ${split} | ${cfg.name} | ${n} | ${((correct / n) * 100).toFixed(1)}% | $${((lossSum / n) * 1000).toFixed(0)} | ${costUnknown ? "unknown" : `$${((cost / n) * 1000).toFixed(4)}`} | ${((escalated / n) * 100).toFixed(1)}% | ${Math.round(latency / n)} ms |`);
      console.log(rows.at(-1));
    }
  }
  const banner = synthetic
    ? "> **Simulated engines.** Shows how the system behaves, not how good real models are. Every case is synthetic (from `pnpm generate-data`) and every answer came from AskWithAI's demo engines."
    : `> **Measured on synthetic data**, n = up to ${MAX_PER_SPLIT} per split, with real models. The cases are synthetic; the answers and costs are real.`;
  writeFileSync(
    "docs/results.md",
    `# Results: three ways to decide

Back to the [overview](README.md). Written by \`pnpm demo:compare\` on ${new Date().toISOString().slice(0, 10)}.

${banner}

| Split | Configuration | Cases | Accuracy | Expected loss per 1,000 | Compute cost per 1,000 | Escalation | Average latency |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}

- **Expected loss** is the main number: the runtime's own mistake costs (a wrong "safe" costs $25 plus $2 per changed line in sensitive paths; a wrong "risky" costs $4) summed over the cases, per 1,000.
- **Decision model only** is the fast tier's own answer (parity). **Reasoning model on everything** uses only the reasoning tier. **AskWithAI routed** starts with the fast tier and escalates when a mistake would cost more than asking; the person tier is off so the three are compared on models alone.
- The **hard** split holds cases whose wording points the wrong way. AskWithAI's own first measured run met its expected-loss goal on the standard holdout but not on the hard split, so both are reported.
`,
  );
  console.log("\nWrote docs/results.md");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
