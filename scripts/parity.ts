import { readFileSync } from "node:fs";
import { askJev } from "@/server/decide/jev";

/**
 * `pnpm parity`: is step 1 (the new base address) really a drop-in? Sends up
 * to 50 synthetic cases to Jev directly twice, and once through AskWithAI's
 * System One endpoint, and reports how often the answers agree, next to how
 * often two direct runs agree (decision models are not guaranteed to be
 * deterministic), plus the added latency. Live calls: needs JEV_DIRECT_API_KEY
 * (the real Jev key) and JEV_BASE_URL / JEV_API_KEY pointing at AskWithAI.
 * The automated check with a recorded response is in src/server/decide/decide.test.ts.
 */

const env = process.env;
const N = Math.min(Number(process.argv[2] ?? 50) || 50, 50);

async function main() {
  if (!env.JEV_DIRECT_API_KEY) {
    console.log("pnpm parity makes live calls to Jev and needs JEV_DIRECT_API_KEY (your Jev key) plus JEV_BASE_URL and JEV_API_KEY pointing at AskWithAI. Nothing was sent.");
    process.exit(1);
  }
  const cases = readFileSync("askwithai/tests/cases.jsonl", "utf8").trim().split("\n").slice(0, N).map((l) => JSON.parse(l) as { id: string; input: never });
  const direct = { ...env, JEV_BASE_URL: env.JEV_DIRECT_BASE_URL ?? "https://api.typesafe.ai", JEV_API_KEY: env.JEV_DIRECT_API_KEY };
  let viaAgree = 0, directAgree = 0, extra = 0, n = 0;
  for (const c of cases) {
    const t0 = Date.now();
    const a = await askJev(c.input, { traceId: c.id, requestId: `parity-a-${c.id}`, env: direct });
    const t1 = Date.now();
    const b = await askJev(c.input, { traceId: c.id, requestId: `parity-b-${c.id}`, env: direct });
    const t2 = Date.now();
    const via = await askJev(c.input, { traceId: c.id, requestId: `parity-via-${c.id}`, env });
    const t3 = Date.now();
    if (!a.answer || !b.answer || !via.answer) continue;
    n++;
    if (a.answer === b.answer) directAgree++;
    if (a.answer === via.answer) viaAgree++;
    extra += t3 - t2 - (t1 - t0);
  }
  console.log(`${n} cases answered. Direct vs direct agree ${((directAgree / n) * 100).toFixed(1)}%; direct vs through AskWithAI agree ${((viaAgree / n) * 100).toFixed(1)}%; added latency about ${Math.round(extra / n)} ms per call.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
