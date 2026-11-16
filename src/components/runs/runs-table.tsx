"use client";

import { Badge } from "@astryxdesign/core/Badge";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Link } from "@astryxdesign/core/Link";
import { HStack } from "@astryxdesign/core/Stack";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { CONCERN_LABEL } from "@pullup/engine/browser";
import type { RunView } from "@/lib/view-types";
import { ResultBadge } from "./result-badge";

export function RunsTable({ runs }: { runs: RunView[] }) {
  if (!runs.length) return <EmptyState title="No runs yet" description="Runs appear when a required workflow finishes on a pull request. In demo mode, play a batch from the Quality page." />;
  return (
    <Table<RunView & Record<string, unknown>>
      data={runs as Array<RunView & Record<string, unknown>>}
      idKey="id"
      density="compact"
      hasHover
      data-testid="runs-table"
      columns={[
        { key: "title", header: "Pull request", renderCell: (r) => <Link href={`/runs/${r.id}`}>{`${r.repo}${r.pull ? `#${r.pull}` : ""} ${r.title}`.trim()}</Link> },
        { key: "result", header: "Check", renderCell: (r) => <ResultBadge result={r.result} state={r.state} /> },
        { key: "mode", header: "Mode", renderCell: (r) => <Text type="supporting">{r.checkMode === "enforce" ? "Enforce" : "Report only"}</Text> },
        {
          key: "concerns",
          header: "Concerns",
          renderCell: (r) => (
            <HStack gap={1} wrap="wrap">
              {r.hardFailures.length ? <Badge variant="error" label="HARD FAILURE" /> : null}
              {r.concerns.map((c) => {
                const a = r.assessments.find((x) => x.concern === c.concern);
                return <Badge key={c.concern} variant={a?.answer === "risky" ? "error" : a?.answer === "safe" ? "success" : "neutral"} label={`${CONCERN_LABEL[c.concern]}: ${a?.answer ?? "?"}`} />;
              })}
              {!r.hardFailures.length && !r.concerns.length && r.result ? <Text type="supporting" color="secondary">nothing tricky</Text> : null}
            </HStack>
          ),
        },
        { key: "decider", header: "Decided by", renderCell: (r) => <Text type="code">{r.decider ?? "code"}</Text> },
        {
          key: "cost",
          header: "Cost",
          align: "end",
          renderCell: (r) => (
            <HStack gap={1} vAlign="center" justify="end">
              <Text type="code">{r.costUsd === null ? "unknown" : `$${r.costUsd.toFixed(4)}`}</Text>
              {r.synthetic && <Badge variant="warning" label="SIMULATED" />}
            </HStack>
          ),
        },
        { key: "at", header: "When", renderCell: (r) => <Text type="supporting">{new Date(r.firstSeenAt).toLocaleString()}</Text> },
      ]}
    />
  );
}
