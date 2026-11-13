import Link from "next/link";
import { ago, dollars, shortSha } from "@/lib/format";
import type { RunRow } from "@/server/dashboard";
import { decisionOf } from "@/lib/run-decision";
import { ResultBadge } from "./result-badge";

export function RunLine({ run }: { run: RunRow }) {
  const decision = decisionOf(run);
  const calls = (decision?.councilCalls ?? 0) + (decision?.extensions?.screenCalls ?? 0);
  return (
    <Link href={`/runs/${run.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-elevated/60 focus-visible:bg-elevated/60 focus-visible:outline-none">
      <ResultBadge result={run.result} state={run.state} mode={run.mode} />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {run.repo}
        {run.pull ? <span className="text-muted-foreground"> #{run.pull}</span> : null}
        <span className="ms-2 font-mono text-xs text-muted-foreground">{shortSha(run.headSha)}</span>
      </span>
      <span className="w-full text-xs text-muted-foreground sm:w-auto">
        {calls ? `${calls} decision calls · ${dollars(run.costUsd)} · ` : ""}
        {ago(run.firstSeenAt)}
      </span>
    </Link>
  );
}

export function RunList({ runs }: { runs: RunRow[] }) {
  return (
    <ul className="divide-y overflow-hidden rounded-lg bg-background ring ring-border">
      {runs.map((run) => (
        <li key={run.id}>
          <RunLine run={run} />
        </li>
      ))}
    </ul>
  );
}
