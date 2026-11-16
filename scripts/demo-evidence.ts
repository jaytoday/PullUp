import { parse, stringify } from "yaml";
import { askwithaiClient, runtimeRef } from "@/server/decide/askwithai";
import { readPackage } from "./package-files";

/**
 * `pnpm demo:evidence`: adds an evidence tier to the runtime as a candidate
 * version. Its one step is a `sandbox_script` that re-runs a failing test's
 * assertion on the values in the log ("expected 3, received 2"): if the
 * values differ, the failure is about the change's own data, not the test
 * environment. The reasoning model then rules with that result in front of it.
 *
 * Sandbox steps run only in Docker on the AskWithAI server. Without Docker the
 * release check refuses the version (and this script says so); with Docker it
 * is promoted and a flaky retry shows the step on its receipt.
 */

const SCRIPT = `
const fs = require("fs");
let evidence = [];
try { evidence = JSON.parse(fs.readFileSync("/input/evidence", "utf8")); } catch {}
const logs = evidence.filter((e) => e.source === "log").map((e) => e.text).join("\\n");
const m = /expected\\s+(\\S+)[^\\n]*?received\\s+(\\S+)/i.exec(logs);
if (!m) console.log("No assertion values in the log: the failure text does not show a behavior difference.");
else if (m[1] === m[2]) console.log("Assertion values match (" + m[1] + "): the failure is not about the values.");
else console.log("Assertion re-run: expected " + m[1] + ", received " + m[2] + ". The values differ, so the failure is about the change's own data.");
`.trim();

async function main() {
  const client = askwithaiClient(process.env);
  const runtime = runtimeRef(process.env);
  if (!client || !runtime) throw new Error("Set ASKWITHAI_URL, ASKWITHAI_API_KEY and PULLUP_RUNTIME first.");
  const files = readPackage("askwithai");
  const doc = parse(files["runtime.yaml"]!) as { spec: { tiers: Array<Record<string, unknown>> } };
  const at = doc.spec.tiers.findIndex((t) => t.kind === "reasoning");
  doc.spec.tiers.splice(at, 0, {
    kind: "evidence",
    id: "rerun_assertion",
    costUsd: 0.001,
    expectedDelayMs: 4000,
    answerWith: "reasoning",
    priorAccuracy: 0.96,
    steps: [{ type: "sandbox_script", id: "assertion", language: "node", inputs: ["evidence"], code: SCRIPT }],
  });
  files["runtime.yaml"] = stringify(doc);
  delete files["tests/cases.jsonl"];
  const v = await client.push(runtime, files, { note: "Evidence tier: re-run a failing assertion in the sandbox" });
  console.log(`Pushed version ${v.version.number} with the sandbox_script evidence step.`);
  const check = (await client.check(runtime, files)) as { passed?: boolean; gates?: Array<{ name: string; passed: boolean; detail: string }> };
  const evidenceGate = check.gates?.find((g) => g.name === "evidence");
  console.log(`Release check, evidence gate: ${evidenceGate ? `${evidenceGate.passed ? "passed" : "refused"}: ${evidenceGate.detail}` : "not reported"}`);
  if (evidenceGate && !evidenceGate.passed) {
    console.log("Start Docker on the AskWithAI server, then run this again to promote it.");
    return;
  }
  await client.request("POST", `/v1/runtimes/${runtime}/versions/${v.version.number}/promote`, { overrideReason: "Demo: evidence tier; other gates judged on synthetic cases." });
  console.log(`Promoted version ${v.version.number}. Flaky retries that escalate now show the sandbox result on their receipt.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
