import { AskWithAIError } from "@askwithai/sdk";
import { readPackage } from "./package-files";
import { migrateDb } from "@/lib/db/client";
import { askwithaiClient, runtimeRef } from "@/server/decide/askwithai";
import { appDeps, playBatch, reportDemoOutcomes, resetDemo } from "@/server/demo";

/**
 * `pnpm demo`: the adoption story on synthetic pull requests, against a
 * local AskWithAI. Needs ASKWITHAI_URL, ASKWITHAI_API_KEY and PULLUP_RUNTIME
 * (for example "you/ci-review") in .env.local. Every number it prints comes
 * from AskWithAI's demo engines and synthetic data: simulated, not measured.
 *
 *   1. Create the runtime from the ci-review template (with its synthetic cases) in parity mode.
 *   2. Baseline through AskWithAI: PullUp's Jev client, base address pointed at the runtime.
 *   3. Shadow: same answers; AskWithAI records what routing would answer.
 *   4. Report outcomes (synthetic ground truth).
 *   5. Active with the SDK: routed answers; some concerns go to a reviewer.
 *   6. Improve: push a rubric change, replay it, and promote it if the release gates pass.
 */

process.env.PULLUP_DEMO = "1";
const env = process.env;
const say = (s: string) => console.log(`\n== ${s}`);

async function main() {
  await migrateDb();
  const client = askwithaiClient(env);
  const runtime = runtimeRef(env);
  if (!client || !runtime) throw new Error("Set ASKWITHAI_URL, ASKWITHAI_API_KEY and PULLUP_RUNTIME (owner/ci-review) in .env.local first. See docs/adopting-askwithai.md.");
  const base = (env.ASKWITHAI_URL ?? "http://localhost:3700").replace(/\/+$/, "");
  if (process.argv.includes("--fresh")) console.log("Cleared", (await resetDemo()).cleared, "demo runs.");

  say("1. Runtime");
  try {
    await client.getRuntime(runtime);
    console.log(`${runtime} exists.`);
  } catch (e) {
    if (!(e instanceof AskWithAIError) || e.status !== 404) throw e;
    await client.request("POST", "/v1/templates/ci-review/use", { slug: runtime.split("/")[1] });
    console.log(`Created ${runtime} from the ci-review template, with its synthetic test cases.`);
    await client.request("POST", `/v1/runtimes/${runtime}/evaluate`, {}).catch(() => undefined);
  }
  await client.setServingMode(runtime, "parity");
  console.log("Serving mode: parity (the fast tier's own answer, now recorded).");

  say("2. Baseline through AskWithAI (Jev client, new base address)");
  const jev = { ...env, PULLUP_DECIDER: "jev", JEV_BASE_URL: `${base}/v1/runtimes/${runtime}`, JEV_API_KEY: env.ASKWITHAI_API_KEY };
  console.log(await playBatch(10, { ...appDeps(), env: jev }, "tune"));

  say("3. Shadow");
  await client.setServingMode(runtime, "shadow");
  console.log(await playBatch(10, { ...appDeps(), env: jev }, "tune"));

  say("4. Outcomes (synthetic ground truth)");
  console.log(await reportDemoOutcomes({ ...appDeps(), env }));

  say("5. Active, with the SDK");
  await client.setServingMode(runtime, "active");
  const sdk = { ...env, PULLUP_DECIDER: "askwithai" };
  console.log(await playBatch(15, { ...appDeps(), env: sdk }, "holdout"));
  console.log(await playBatch(20, { ...appDeps(), env: sdk }, "hard"));
  const pending = (await client.listReviews("pending")).data.length;
  console.log(`${pending} review(s) wait in PullUp's /reviews (or AskWithAI's Reviews page).`);

  say("6. Improve: add a rubric note for two false-positive traps");
  await reportDemoOutcomes({ ...appDeps(), env });
  const files = readPackage("askwithai");
  files["rubrics/fast.md"] +=
    "\n- If the log says the test database container was restarting, or the diff only fixes a typo in permission error text, answer safe.\n";
  const pushed = await client.push(runtime, files, { note: "Rubric: container-restart and permission-typo traps are safe" });
  console.log(`Pushed version ${pushed.version.number} (${pushed.version.status}).`);
  const replay = await client.replay(runtime, pushed.version.number, { against: "live", since: "24h", limit: 100 });
  console.log(
    `Replay (simulated): accuracy ${replay.baseline.accuracy ?? "n/a"} -> ${replay.candidate.accuracy ?? "n/a"}, escalation ${replay.baseline.escalationShare ?? "n/a"} -> ${replay.candidate.escalationShare ?? "n/a"}, cost/1k $${replay.baseline.costPer1000Usd ?? 0} -> $${replay.candidate.costPer1000Usd ?? 0}.`,
  );
  for (const n of replay.notes) console.log(`  note: ${n}`);
  for (let i = 0; i < 30; i++) {
    const chk = await client.check(runtime, files);
    if (chk.passed || !chk.gates.some((g) => /Run a benchmark|no usable benchmark/i.test(g.detail))) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    await client.request("POST", `/v1/runtimes/${runtime}/versions/${pushed.version.number}/promote`, {});
    console.log(`Promoted version ${pushed.version.number}.`);
  } catch (e) {
    console.log(`Not promoted: ${(e as Error).message} (promote it in AskWithAI with a written reason if you accept the replay).`);
  }
  const stats = await client.stats(runtime, "24h");
  console.log("\nAskWithAI stats, last 24 hours (simulated):", JSON.stringify((stats as { totals?: unknown }).totals));
  console.log(`\nOpen http://localhost:3500/runs, /decisions, /reviews and /quality.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
