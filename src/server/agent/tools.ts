import { z } from "zod";
import { assessInput, type ConcernCase, type Config, type HardFailure, type ParsedCiRun, parseDiff, quoteChecksOut } from "@pullup/engine";
import type { ProviderAnswer } from "../decide";

/**
 * The agent's tools, written once and served to every harness (the AI SDK
 * loop, the Claude Agent SDK, and the scripted planner). The guardrails live
 * here, in code: reads are bounded, `assess` only takes concerns code
 * detected and sends their exact evidence, extra quotes must exist in the
 * diff or a log, each concern is assessed once, a rerun happens at most once
 * and only when the repository allows it, and input requests are answered
 * from repository facts, never from the agent's text.
 */

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  at: string;
}

export interface AgentContext {
  run: ParsedCiRun;
  config: Config;
  concerns: ConcernCase[];
  hardFailures: HardFailure[];
  /** Ask the decision runtime about one concern (the provider behind `PULLUP_DECIDER`). */
  assess: (c: ConcernCase, input: ReturnType<typeof assessInput>) => Promise<ProviderAnswer>;
  /** Supply a fact a decision is waiting for; returns the updated answer. */
  answerInput: (decisionId: string, field: string, value: unknown, expectedVersion: number) => Promise<ProviderAnswer>;
  /** Read a file at the head commit, or null when it cannot be read. */
  readFile?: (path: string) => Promise<string | null>;
  /** Rerun a required workflow's failed jobs (only when `flaky.rerun` is on). */
  rerun?: (workflow: string) => Promise<string>;
}

export interface ToolSpec {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const MAX_READ = 6000;
const clip = (s: string) => (s.length > MAX_READ ? `${s.slice(0, MAX_READ)}\n[... cut at ${MAX_READ} characters]` : s);

/** Repository facts PullUp may give when a decision asks; the agent names the concern, code finds the value. */
export function repositoryFact(field: string, ctx: Pick<AgentContext, "run" | "config">): { value: unknown } | null {
  if (field === "known_flaky") {
    const known = new Set(ctx.config.flaky.knownTests);
    const failed = ctx.run.jobs.flatMap((j) => j.attempts.flatMap((a) => a.failedTests));
    return { value: failed.length > 0 && failed.every((t) => known.has(t)) };
  }
  return null;
}

export class AgentSession {
  readonly steps: AgentStep[] = [];
  readonly answers = new Map<string, ProviderAnswer>();
  private rerunDone = false;
  finished = false;

  constructor(readonly ctx: AgentContext) {}

  private note(tool: string, args: Record<string, unknown>, summary: string) {
    this.steps.push({ tool, args, summary, at: new Date().toISOString() });
  }

  tools(): ToolSpec[] {
    const { run, concerns, config } = this.ctx;
    const concernEnum = z.enum(concerns.length ? (concerns.map((c) => c.concern) as [string, ...string[]]) : ["none"]);
    return [
      {
        name: "get_ci_summary",
        description: "Jobs, attempts and failing tests of this commit's CI, and the concerns code flagged.",
        shape: {},
        run: async () => {
          const out = {
            repository: run.repo,
            pullRequest: run.pull ? { number: run.pull.number, title: run.pull.title, body: run.pull.body.slice(0, 1000) } : null,
            jobs: run.jobs.map((j) => ({ workflow: j.workflow, job: j.name, attempts: j.attempts.map((a) => ({ conclusion: a.conclusion, failedTests: a.failedTests })) })),
            concerns: concerns.map((c) => ({ concern: c.concern, summary: c.summary, blastRadius: c.blastRadius })),
            changedFiles: parseDiff(run.diff).map((f) => `${f.status} ${f.path}`),
          };
          this.note("get_ci_summary", {}, `${run.jobs.length} jobs, ${concerns.length} concerns`);
          return out;
        },
      },
      {
        name: "read_log",
        description: "The end of a job's failed attempts' logs.",
        shape: { workflow: z.string(), job: z.string() },
        run: async (a) => {
          const job = run.jobs.find((j) => j.workflow === a.workflow && j.name === a.job);
          this.note("read_log", a, job ? `${a.workflow} / ${a.job}` : "no such job");
          if (!job) return { error: "No such job." };
          return { attempts: job.attempts.map((x, i) => ({ attempt: i + 1, conclusion: x.conclusion, log: clip(x.logExcerpt) })) };
        },
      },
      {
        name: "read_diff",
        description: "The pull request's diff, or one file's part of it.",
        shape: { path: z.string().optional() },
        run: async (a) => {
          const files = parseDiff(run.diff).filter((f) => !a.path || f.path === a.path || f.oldPath === a.path);
          this.note("read_diff", a, a.path ? String(a.path) : "whole diff");
          return { files: files.map((f) => ({ path: f.path, status: f.status, lines: clip(f.lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "remove" ? "-" : " "}${l.text}`).join("\n")) })) };
        },
      },
      {
        name: "read_file",
        description: "A file at the pull request's head commit.",
        shape: { path: z.string() },
        run: async (a) => {
          const text = this.ctx.readFile ? await this.ctx.readFile(String(a.path)).catch(() => null) : null;
          this.note("read_file", a, text === null ? "not available" : `${text.length} characters`);
          return text === null ? { error: "The file could not be read." } : { text: clip(text) };
        },
      },
      {
        name: "rerun_job",
        description: "Rerun a required workflow's failed jobs once. Only when the repository allows reruns.",
        shape: { workflow: z.string() },
        run: async (a) => {
          if (!config.flaky.rerun || !this.ctx.rerun) return this.refuse("rerun_job", a, "This repository does not allow reruns.");
          if (this.rerunDone) return this.refuse("rerun_job", a, "A rerun was already requested for this commit.");
          if (!config.requiredWorkflows.includes(String(a.workflow))) return this.refuse("rerun_job", a, "Not a required workflow.");
          this.rerunDone = true;
          const result = await this.ctx.rerun(String(a.workflow));
          this.note("rerun_job", a, result);
          return { result };
        },
      },
      {
        name: "assess",
        description: "Ask the decision runtime whether one flagged concern is risky or safe to merge. Sends the concern's evidence; extra_quotes must be copied exactly from the diff or a log.",
        shape: { concern: concernEnum, extra_quotes: z.array(z.string()).max(3).optional() },
        run: async (a) => this.assess(String(a.concern), (a.extra_quotes as string[] | undefined) ?? []),
      },
      {
        name: "answer_input_request",
        description: "When an assessment waits for a fact, let PullUp answer it from the repository.",
        shape: { concern: concernEnum },
        run: async (a) => this.answerInput(String(a.concern)),
      },
      {
        name: "finish",
        description: "End the review once every concern is assessed.",
        shape: { note: z.string().max(500).optional() },
        run: async (a) => {
          this.finished = true;
          const missing = concerns.filter((c) => !this.answers.has(c.concern)).map((c) => c.concern);
          this.note("finish", a, missing.length ? `not assessed: ${missing.join(", ")}` : "all concerns assessed");
          return { assessed: [...this.answers.keys()], notAssessed: missing };
        },
      },
    ];
  }

  private refuse(tool: string, args: Record<string, unknown>, why: string) {
    this.note(tool, args, `refused: ${why}`);
    return { error: why };
  }

  async assess(concern: string, extraQuotes: string[] = []) {
    const c = this.ctx.concerns.find((x) => x.concern === concern);
    if (!c) return this.refuse("assess", { concern }, "Code did not flag this concern.");
    const done = this.answers.get(concern);
    if (done) return this.refuse("assess", { concern }, `Already assessed: ${done.answer ?? done.status}.`);
    const input = assessInput(c, this.ctx.run);
    const kept = extraQuotes.filter((q) => quoteChecksOut({ quote: q }, this.ctx.run));
    for (const q of kept) input.evidence.push({ source: "diff", where: "agent quote", text: q });
    const answer = await this.ctx.assess(c, input);
    this.answers.set(concern, answer);
    this.note("assess", { concern, extra_quotes: extraQuotes }, `${answer.answer ?? "no answer"} (${answer.status}${answer.synthetic ? ", simulated" : ""})${kept.length < extraQuotes.length ? `; dropped ${extraQuotes.length - kept.length} quote(s) not found in the change` : ""}`);
    return { concern, status: answer.status, answer: answer.answer, final: answer.final, decisionId: answer.decisionId, waitingFor: answer.inputRequest?.question ?? null };
  }

  async answerInput(concern: string) {
    const a = this.answers.get(concern);
    if (!a?.decisionId || !a.inputRequest) return this.refuse("answer_input_request", { concern }, "This assessment is not waiting for a fact.");
    const fact = repositoryFact(a.inputRequest.field, this.ctx);
    if (!fact) return this.refuse("answer_input_request", { concern }, `PullUp has no repository fact for "${a.inputRequest.field}"; a person answers it.`);
    const updated = await this.ctx.answerInput(a.decisionId, a.inputRequest.field, fact.value, a.inputRequest.expectedVersion);
    this.answers.set(concern, updated);
    this.note("answer_input_request", { concern }, `${a.inputRequest.field} = ${JSON.stringify(fact.value)}; now ${updated.answer ?? updated.status}`);
    return { concern, field: a.inputRequest.field, value: fact.value, status: updated.status, answer: updated.answer };
  }
}
