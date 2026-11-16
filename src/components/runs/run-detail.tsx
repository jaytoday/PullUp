"use client";

import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { DecisionFeed } from "@askwithai/react";
import { CONCERN_LABEL, decideRun } from "@pullup/engine/browser";
import type { RunView } from "@/lib/view-types";
import { ResultBadge } from "./result-badge";

/** One run: CI, hard failures, each concern with its assessment and the policy's reading, the agent's steps, and the decisions in AskWithAI. */
export function RunDetail({ run, runtime }: { run: RunView; runtime: string | null }) {
  const policy = decideRun(run.hardFailures, run.assessments, run.checkMode);
  return (
    <VStack gap={4}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Heading level={1}>{`${run.repo}${run.pull ? `#${run.pull}` : ""}`}</Heading>
        <ResultBadge result={run.result} state={run.state} />
        <Badge variant="neutral" label={run.checkMode === "enforce" ? "ENFORCE" : "REPORT ONLY"} />
        {run.synthetic && <Badge variant="warning" label="SYNTHETIC DATA" />}
      </HStack>
      <Text color="secondary">
        {run.title} · <Text type="code">{run.headSha.slice(0, 12)}</Text> · decided by {run.decider ?? "code alone"}
        {run.harness ? ` with the ${run.harness} agent` : ""}
      </Text>
      {run.reason && <Banner status={run.result === "fail" ? "error" : run.result === "waiting" ? "warning" : "success"} title={run.reason} />}
      {run.error && <Banner status="error" title="This run could not be decided" description={run.error} />}
      <Card padding={4}>
        <VStack gap={2}>
          <Text weight="semibold">CI</Text>
          {run.ci.map((j) => (
            <Text key={`${j.workflow}/${j.job}`} type="supporting">
              {j.workflow} / {j.job}: {j.attempts.join(" → ")}
            </Text>
          ))}
          {run.hardFailures.map((f, i) => (
            <HStack key={i} gap={2} vAlign="center">
              <Badge variant="error" label="HARD FAILURE" />
              <Text>{f.reason}</Text>
            </HStack>
          ))}
        </VStack>
      </Card>
      {run.concerns.map((c) => {
        const a = run.assessments.find((x) => x.concern === c.concern);
        const p = policy.concerns.find((x) => x.concern === c.concern);
        return (
          <Card key={c.concern} padding={4} data-testid={`concern-${c.concern}`}>
            <VStack gap={2}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text weight="semibold">{CONCERN_LABEL[c.concern]}</Text>
                {a && <Badge variant={a.answer === "risky" ? "error" : a.answer === "safe" ? "success" : "neutral"} label={`${a.answer ?? "no answer"}${a.final ? "" : " (provisional)"}`} />}
                {p && <Badge variant={p.outcome === "fail" ? "error" : p.outcome === "pass" ? "success" : "warning"} label={`policy: ${p.outcome}`} />}
                {a?.synthetic && <Badge variant="warning" label="SIMULATED" />}
              </HStack>
              <Text color="secondary">{c.summary}</Text>
              {a && (
                <Text type="supporting">
                  {a.provider} · {a.status} · answered by {a.answeredBy ?? "?"} · p(risky) {a.probability === null ? "n/a" : a.probability.toFixed(2)} · cost {a.costUsd === null ? "unknown" : `$${a.costUsd.toFixed(4)}`}
                  {a.decisionId ? ` · ${a.decisionId}` : ""}
                  {a.error ? ` · ${a.error}` : ""}
                </Text>
              )}
              {p && <Text type="supporting">{p.reason}</Text>}
              {a?.verified.map((q, i) => (
                <Text key={i} type="code">
                  &gt; {q.quote}
                </Text>
              ))}
            </VStack>
          </Card>
        );
      })}
      {run.agentSteps.length > 0 && (
        <Card padding={4}>
          <VStack gap={1} data-testid="agent-steps">
            <Text weight="semibold">Agent steps ({run.harness})</Text>
            {run.agentSteps.map((s, i) => (
              <Text key={i} type="supporting">
                {i + 1}. <Text type="code">{s.tool}</Text> {s.summary}
              </Text>
            ))}
          </VStack>
        </Card>
      )}
      {run.notes.map((n, i) => (
        <Text key={i} type="supporting" color="secondary">
          Note: {n}
        </Text>
      ))}
      {runtime && run.concerns.length > 0 && (
        <VStack gap={2}>
          <Text weight="semibold">Decisions in AskWithAI for this commit</Text>
          <DecisionFeed runtime={runtime} traceId={run.headSha} limit={20} />
        </VStack>
      )}
    </VStack>
  );
}
