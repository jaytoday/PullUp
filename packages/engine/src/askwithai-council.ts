import { createHash } from "node:crypto";
import type { AskWithAI, Decision } from "@askwithai/client";
import type { ParsedCiRun, Question } from "@pullup/sdk";
import type { Council, RawSeatAnswer } from "./council";

export const ASK_WITH_AI_SEAT = "askwithai:decision-runtime";
const MAX_LOG_CONTEXT_CHARS = 20_000;

function boundedJobs(run: ParsedCiRun) {
  let remaining = MAX_LOG_CONTEXT_CHARS;
  return run.jobs.slice(0, 20).map((job) => ({
    workflow: job.workflow.slice(0, 200),
    name: job.name.slice(0, 200),
    attempts: job.attempts.slice(-2).map((attempt) => {
      const logExcerpt = remaining > 0 ? attempt.logExcerpt.slice(-remaining) : "";
      remaining = Math.max(0, remaining - logExcerpt.length);
      return { conclusion: attempt.conclusion, failedTests: attempt.failedTests.slice(0, 40).map((test) => test.slice(0, 300)), logExcerpt, logsTruncated: logExcerpt.length < attempt.logExcerpt.length };
    }),
  }));
}

export function askWithAICouncil(options: { client: AskWithAI; runtime: string; version?: number; answerKey?: string; timeoutMs?: number }): Council {
  return async (question: Question, run: ParsedCiRun, seats: string[]): Promise<RawSeatAnswer[]> => {
    const requestId = `${run.repo}:${run.headSha}:${question.id}`;
    const input = {
        repository: run.repo,
        pullRequest: run.pull ? { number: run.pull.number, title: run.pull.title.slice(0, 500), body: run.pull.body.slice(0, 4_000), labels: run.pull.labels.slice(0, 20), author: run.pull.author.slice(0, 100) } : null,
        headSha: run.headSha,
        questionId: question.id,
        extension: question.extension,
        prompt: question.prompt,
        summary: question.summary,
        extensionContext: question.seatContext?.slice(0, 4_000) ?? null,
        viewpoints: seats,
        evidence: question.evidence,
        jobs: boundedJobs(run),
        diff: run.diff.slice(0, 40_000),
        diffTruncated: run.diff.length > 40_000,
      };
    const idempotencyKey = createHash("sha256").update(`${requestId}\0${JSON.stringify(input)}`).digest("hex");
    try {
      const decision = await options.client.decide(options.runtime, input, {
        version: options.version,
        requestId,
        traceId: `${run.repo}:${run.headSha}`,
        stepName: `${question.extension}:${question.id}`,
        idempotencyKey,
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });
      const questionKey = options.answerKey ?? Object.keys(decision.decisions)[0] ?? "";
      return [{ seat: ASK_WITH_AI_SEAT, answer: mapDecision(decision, options.answerKey), costUsd: decision.costUsd, durationMs: decision.latencyMs, platformDecision: { id: decision.id, runtime: decision.runtime, version: decision.version, status: decision.status, synthetic: decision.synthetic, questionKey, requestId, costUsd: decision.costUsd, latencyMs: decision.latencyMs, receipt: decision.receipt } }];
    } catch (error) {
      return [{ seat: ASK_WITH_AI_SEAT, answer: null, error: (error as Error).message }];
    }
  };
}

function mapDecision(decision: Decision, answerKey?: string): unknown {
  const entry = answerKey ? decision.decisions[answerKey] : Object.values(decision.decisions)[0];
  if (decision.status !== "decided" || decision.synthetic || !entry?.final || !entry.answer) return null;
  const receipt = answerKey ? decision.receipt.questions[answerKey] : Object.values(decision.receipt.questions)[0];
  const verdict = entry.answer === "needs_person" ? "needs-person" : entry.answer;
  const quotes = (receipt?.citations ?? []).flatMap((citation) => {
    if (!["diff", "log", "report"].includes(citation.source ?? "")) return [];
    return [{ source: citation.source, text: citation.quote }];
  });
  return {
    verdict,
    strength: strengthFromProbability(entry.probability),
    reason: receipt?.reason ?? "AskWithAI returned no explanation.",
    quotes,
  };
}

function strengthFromProbability(probability: number | null): number {
  const p = Number.isFinite(probability) ? Math.max(0, Math.min(1, probability!)) : 0.5;
  if (p >= 0.95) return 5;
  if (p >= 0.85) return 4;
  if (p >= 0.7) return 3;
  if (p >= 0.55) return 2;
  return 1;
}
