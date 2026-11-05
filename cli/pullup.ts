import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import {
  type Council,
  ciRunSchema,
  decideRun,
  describeExtensions,
  fileRequests,
  matchesAny,
  type ReadFile,
  jobSchema,
  parseConfig,
  type ParsedCiRun,
  type Recording,
  recordingCouncil,
  replayCouncil,
  recordingScreener,
  replayScreener,
  type Screener,
  withaiScreener,
  type RunDecision,
  withaiCouncil,
  type Config,
} from "@pullup/engine";
import { WithAIClient } from "@withai/client";
import { z } from "zod";

/**
 * `pullup check`: decide one run locally and print what the council said and
 * what the rule decided. Nothing is posted anywhere (shadow only). It runs the
 * same extension host as the server, in the same order.
 *
 *   pullup check --fixture fixtures/weakened-skip.json
 *   pullup check --base main [--jobs jobs.json]        (the current branch)
 *   … --replay answers.json                            (recorded council answers, no WithAI call)
 *   … --record answers.json                            (call WithAI and save its answers)
 *   … --only threat-model                              (run one extension; repeat for more)
 *
 * `pullup extensions` lists the bundled extensions and their settings.
 *
 * A live council needs WITHAI_URL and WITHAI_TOKEN, and PULLUP_SKILL_ID (the
 * workspace's CI policy skill; without it the skill is created from WithAI's
 * template, which needs a token with `skills:write`).
 */

const USAGE = "Usage: pullup check [--fixture file | --base branch [--jobs file]] [--replay file | --record file] [--only extension]... [--json]\n       pullup extensions [--json]";

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
  const files = localFiles(cwd, base, config);
  const run = ciRunSchema.parse({ repo, headSha: git(cwd, "rev-parse", "HEAD"), jobs, diff: git(cwd, "diff", `${base}...HEAD`) + "\n", files });
  return { run, config, notes };
}

/** The files extensions ask for: from `base` (the default branch) and from HEAD, with git, as the server reads them from GitHub. */
function localFiles(cwd: string, base: string, config: Config): ReadFile[] {
  const out: ReadFile[] = [];
  const requests = fileRequests(config);
  for (const [from, ref] of [["default", base], ["head", "HEAD"]] as const) {
    const globs = requests.filter((r) => r.from === from).flatMap((r) => r.globs);
    if (!globs.length) continue;
    for (const path of git(cwd, "ls-tree", "-r", "--name-only", ref).split("\n").filter((p) => p && matchesAny(p, globs))) {
      out.push({ path, text: git(cwd, "show", `${ref}:${path}`), from });
    }
  }
  return out;
}

export function fixtureRun(file: string): CheckInput {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { config: unknown; run: unknown };
  return { run: ciRunSchema.parse(raw.run), config: parseConfig(raw.config), notes: [`Fixture: ${file}`] };
}

async function liveWithai(env: NodeJS.ProcessEnv): Promise<{ council: Council; screener: Screener }> {
  const baseUrl = env.WITHAI_URL?.trim();
  const token = env.WITHAI_TOKEN?.trim();
  if (!baseUrl || !token) throw new Error("Set WITHAI_URL and WITHAI_TOKEN for a live council, or pass --replay with recorded answers.");
  const client = new WithAIClient({ baseUrl, token });
  const id = env.PULLUP_SKILL_ID?.trim() || (await client.createSkill({ template: "ci-policy" })).skill.id;
  return { council: withaiCouncil({ client, skill: { id } }), screener: withaiScreener({ client, skill: { id } }) };
}

export function formatDecision(input: CheckInput, decision: RunDecision, seconds: number): string {
  const out: string[] = [...input.notes.map((n) => `note: ${n}`), `${input.run.repo} @ ${input.run.headSha.slice(0, 7)}`, ""];
  for (const f of decision.hardFailures) out.push(`hard failure: ${f.reason}`);
  for (const q of decision.questions) {
    out.push(`question (${q.question.id}${q.question.shadow ? ", shadow" : ""}): ${q.question.prompt}`, `  ${q.question.summary}`);
    if (q.question.relaxedBy) out.push(`  relaxed by ${q.question.relaxedBy.extension}: ${q.question.relaxedBy.why}`);
    for (const s of q.seats) {
      out.push(`  - ${s.seat.split(":")[0]}: ${s.verdict} (strength ${s.strength})${s.reason ? ` — ${s.reason}` : ""}`);
      for (const quote of s.validQuotes) out.push(`      quote (${quote.source}, checks out): "${quote.text}"`);
      for (const p of s.problems) out.push(`      ! ${p}`);
    }
    out.push(`  → ${q.outcome === "ask" ? `would ask ${(q.question.askTo ?? [input.config.ask.to]).join(", ")}` : q.outcome}: ${q.reason}`);
  }
  const ext = decision.extensions;
  for (const n of ext?.notes ?? []) out.push(`note (${n.extension}): ${n.text}${n.link ? ` ${n.link}` : ""}`);
  for (const a of ext?.annotations ?? []) out.push(`annotation (${a.extension}): ${a.path}:${a.line} ${a.message}`);
  for (const s of ext?.screens ?? []) out.push(`screen (${s.extension}:${s.key}): ${s.status === "answered" ? `${s.result} (${s.confidence})` : `not checked, ${s.why}`}`);
  for (const r of ext?.relaxations ?? []) if (!r.applied) out.push(`relaxation refused (${r.extension} → ${r.question}): ${r.refused}`);
  if (ext) out.push(`extensions: ${ext.outputs.map((o) => `${o.id}@${o.version} (${o.mode})${o.error ? ` FAILED: ${o.error}` : ""}`).join(", ")}`);
  out.push("", `RESULT: ${decision.result.toUpperCase()} — ${decision.reason}`);
  out.push(`council calls: ${decision.councilCalls}, cost: $${decision.costUsd.toFixed(4)}, time: ${seconds.toFixed(1)} s`);
  return out.join("\n");
}

export async function check(argv: string[], env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<{ text: string; decision: RunDecision }> {
  const { values } = parseArgs({
    args: argv,
    options: { fixture: { type: "string" }, base: { type: "string" }, jobs: { type: "string" }, replay: { type: "string" }, record: { type: "string" }, only: { type: "string", multiple: true }, json: { type: "boolean" } },
  });
  if (values.replay && values.record) throw new Error(USAGE);
  const input = values.fixture ? fixtureRun(values.fixture) : localRun(cwd, values.base ?? "main", values.jobs);
  const recording: Recording = {};
  // Built lazily and once: a run with a hard failure or no question never needs WithAI.
  let live: Promise<{ council: Council; screener: Screener }> | undefined;
  const connect = () =>
    (live ??= liveWithai(env).then((w) => (values.record ? { council: recordingCouncil(w.council, recording), screener: recordingScreener(w.screener, recording) } : w)));
  const replayed = values.replay ? (JSON.parse(readFileSync(values.replay, "utf8")) as Recording) : null;
  const council: Council = replayed ? replayCouncil(replayed) : async (q, run, seats) => (await connect()).council(q, run, seats);
  const screener: Screener = replayed ? replayScreener(replayed) : async (s, run) => (await connect()).screener(s, run);
  const started = performance.now();
  const unknown = (values.only ?? []).filter((id) => !(id in input.config.extensions) || input.config.extensions[id]!.mode === "off");
  if (unknown.length) throw new Error(`--only: not switched on in this config: ${unknown.join(", ")}`);
  const decision = await decideRun(input.run, input.config, council, { now: Date.now(), only: values.only, screener });
  if (values.record) writeFileSync(values.record, `${JSON.stringify(recording, null, 2)}\n`);
  const seconds = (performance.now() - started) / 1000;
  return { text: values.json ? JSON.stringify(decision, null, 2) : formatDecision(input, decision, seconds), decision };
}

/** `pullup extensions`: the bundled extensions, what they do and their settings. */
export function extensions(argv: string[]): string {
  const list = describeExtensions();
  if (argv.includes("--json")) return JSON.stringify(list, null, 2);
  return list
    .map((e) =>
      [
        `${e.id}@${e.version} — ${e.title}${e.defaultMode === "active" ? " (on unless switched off)" : ""}`,
        `  ${e.summary}`,
        ...e.fields.map((f) => `  - ${e.id}.${f.key} (${f.kind}, default ${JSON.stringify(f.key.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k], e.defaults))})${f.loosens ? " [loosens]" : ""}: ${f.label}`),
      ].join("\n"),
    )
    .join("\n\n");
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "extensions") {
    console.log(extensions(rest));
    process.exit(0);
  }
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
