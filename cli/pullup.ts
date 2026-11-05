import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import {
  type Council,
  ciRunSchema,
  decideRun,
  jobSchema,
  parseConfig,
  type ParsedCiRun,
  type Recording,
  recordingCouncil,
  replayCouncil,
  type RunDecision,
  withaiCouncil,
  type Config,
} from "@pullup/engine";
import { WithAIClient } from "@withai/client";
import { z } from "zod";

/**
 * `pullup check`: decide one run locally and print what the council said and
 * what the rule decided. Nothing is posted anywhere (shadow only).
 *
 *   pullup check --fixture fixtures/weakened-skip.json
 *   pullup check --base main [--jobs jobs.json]        (the current branch)
 *   … --replay answers.json                            (recorded council answers, no WithAI call)
 *   … --record answers.json                            (call WithAI and save its answers)
 *
 * A live council needs WITHAI_URL and WITHAI_TOKEN, and PULLUP_SKILL_ID (the
 * workspace's CI policy skill; without it the skill is created from WithAI's
 * template, which needs a token with `skills:write`).
 */

const USAGE = "Usage: pullup check [--fixture file | --base branch [--jobs file]] [--replay file | --record file] [--json]";

export interface CheckInput {
  run: ParsedCiRun;
  config: Config;
  /** Notes about how the run was put together (shown above the result). */
  notes: string[];
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();

/**
 * The current branch as a run: its diff against `base`, and the config from
 * `base` (the default branch), never from the branch itself.
 */
export function localRun(cwd: string, base: string, jobsFile?: string): CheckInput {
  const notes: string[] = [];
  let rawConfig: string;
  try {
    rawConfig = git(cwd, "show", `${base}:.pullup/config.json`);
  } catch {
    throw new Error(`No .pullup/config.json on ${base}. PullUp reads its config from the default branch only.`);
  }
  if (existsSync(`${cwd}/.pullup/config.json`) && readFileSync(`${cwd}/.pullup/config.json`, "utf8").trim() !== rawConfig.trim()) {
    notes.push(`.pullup/config.json on this branch differs from ${base}; it is ignored (config comes from the default branch).`);
  }
  const config = parseConfig(JSON.parse(rawConfig));
  const jobs = jobsFile
    ? z.array(jobSchema).parse(JSON.parse(readFileSync(jobsFile, "utf8")))
    : config.requiredWorkflows.map((workflow) => ({ workflow, name: workflow, attempts: [{ conclusion: "success" as const, failedTests: [], logExcerpt: "" }] }));
  if (!jobsFile) notes.push("No CI results given (--jobs); the required workflows are assumed to have passed.");
  let repo = basename(cwd);
  try {
    repo = git(cwd, "remote", "get-url", "origin").replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, "$1");
  } catch {
    // No remote: the folder name will do.
  }
  const run = ciRunSchema.parse({ repo, headSha: git(cwd, "rev-parse", "HEAD"), jobs, diff: git(cwd, "diff", `${base}...HEAD`) + "\n" });
  return { run, config, notes };
}

export function fixtureRun(file: string): CheckInput {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { config: unknown; run: unknown };
  return { run: ciRunSchema.parse(raw.run), config: parseConfig(raw.config), notes: [`Fixture: ${file}`] };
}

async function liveCouncil(env: NodeJS.ProcessEnv): Promise<Council> {
  const baseUrl = env.WITHAI_URL?.trim();
  const token = env.WITHAI_TOKEN?.trim();
  if (!baseUrl || !token) throw new Error("Set WITHAI_URL and WITHAI_TOKEN for a live council, or pass --replay with recorded answers.");
  const client = new WithAIClient({ baseUrl, token });
  const id = env.PULLUP_SKILL_ID?.trim() || (await client.createSkill({ template: "ci-policy" })).skill.id;
  return withaiCouncil({ client, skill: { id } });
}

export function formatDecision(input: CheckInput, decision: RunDecision, seconds: number): string {
  const out: string[] = [...input.notes.map((n) => `note: ${n}`), `${input.run.repo} @ ${input.run.headSha.slice(0, 7)}`, ""];
  for (const f of decision.hardFailures) out.push(`hard failure: ${f.reason}`);
  for (const q of decision.questions) {
    out.push(`question (${q.question.id}${q.question.shadow ? ", shadow" : ""}): ${q.question.prompt}`, `  ${q.question.summary}`);
    for (const s of q.seats) {
      out.push(`  - ${s.seat.split(":")[0]}: ${s.verdict} (strength ${s.strength})${s.reason ? ` — ${s.reason}` : ""}`);
      for (const quote of s.validQuotes) out.push(`      quote (${quote.source}, checks out): "${quote.text}"`);
      for (const p of s.problems) out.push(`      ! ${p}`);
    }
    out.push(`  → ${q.outcome === "ask" ? `would ask ${input.config.ask.to}` : q.outcome}: ${q.reason}`);
  }
  out.push("", `RESULT: ${decision.result.toUpperCase()} — ${decision.reason}`);
  out.push(`council calls: ${decision.councilCalls}, cost: $${decision.costUsd.toFixed(4)}, time: ${seconds.toFixed(1)} s`);
  return out.join("\n");
}

export async function check(argv: string[], env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<{ text: string; decision: RunDecision }> {
  const { values } = parseArgs({
    args: argv,
    options: { fixture: { type: "string" }, base: { type: "string" }, jobs: { type: "string" }, replay: { type: "string" }, record: { type: "string" }, json: { type: "boolean" } },
  });
  if (values.replay && values.record) throw new Error(USAGE);
  const input = values.fixture ? fixtureRun(values.fixture) : localRun(cwd, values.base ?? "main", values.jobs);
  const recording: Recording = {};
  // Built lazily and once: a run with a hard failure or no question never needs WithAI.
  let live: Promise<Council> | undefined;
  const council: Council = values.replay
    ? replayCouncil(JSON.parse(readFileSync(values.replay, "utf8")) as Recording)
    : async (q, run, seats) => {
        live ??= liveCouncil(env).then((c) => (values.record ? recordingCouncil(c, recording) : c));
        return (await live)(q, run, seats);
      };
  const started = performance.now();
  const decision = await decideRun(input.run, input.config, council);
  if (values.record) writeFileSync(values.record, `${JSON.stringify(recording, null, 2)}\n`);
  const seconds = (performance.now() - started) / 1000;
  return { text: values.json ? JSON.stringify(decision, null, 2) : formatDecision(input, decision, seconds), decision };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "check") {
    console.error(USAGE);
    process.exit(2);
  }
  check(rest).then(
    ({ text, decision }) => {
      console.log(text);
      process.exit(decision.result === "fail" ? 1 : 0);
    },
    (error: Error) => {
      console.error(error.message);
      process.exit(2);
    },
  );
}
