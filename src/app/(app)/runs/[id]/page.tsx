import type { AskState } from "@pullup/engine";
import { notFound } from "next/navigation";
import { DashboardPanel, PageBody } from "@/components/app-shell/dashboard-panel";
import { AutoRefresh } from "@/components/common/auto-refresh";
import { BorderBeam } from "@/components/effects/border-beam";
import { QuestionCard } from "@/components/runs/question-card";
import { ModeBadge, ResultBadge } from "@/components/runs/result-badge";
import { RunTimeline, type TimelineStep } from "@/components/runs/run-timeline";
import { Badge } from "@/components/ui/badge";
import { dollars, shortSha } from "@/lib/format";
import { decidedBy, decisionOf, runDetail } from "@/server/dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await runDetail(id);
  if (!detail) notFound();
  const { run, evidence, chainOk } = detail;
  const asks = Object.fromEntries(Object.entries(detail.asks).map(([k, v]) => [k, v.state])) as Record<string, AskState>;
  const decision = decisionOf(run);
  const settledBy = decidedBy(run, asks);
  const working = run.lockedUntil !== null && run.lockedUntil.getTime() > Date.now();
  const hard = decision?.hardFailures.length ?? 0;
  const questions = decision?.questions ?? [];
  const asked = Object.keys(asks).length;

  const steps: TimelineStep[] = [
    { label: "Collect", detail: run.state === "collecting" ? `Waiting for ${run.pending.join(", ") || "the required workflows"}` : "Job results, reruns, logs and the diff collected", state: run.state === "collecting" ? "current" : "done" },
    { label: "Hard failures", detail: hard ? `${hard} hard failure${hard > 1 ? "s" : ""}: fail with no AI call` : "None", state: decision ? "done" : "todo" },
    { label: "Triggers", detail: hard ? "Not needed" : questions.length ? questions.map((q) => q.question.trigger).join(", ") : "None fired: pass with no AI call", state: !decision ? "todo" : hard ? "skipped" : "done" },
    { label: "Council", detail: run.councilCalls ? `${run.councilCalls} seat calls, ${dollars(run.costUsd)}` : "Not called", state: !decision ? "todo" : run.councilCalls ? "done" : "skipped" },
    { label: "Person", detail: asked ? settledBy : run.mode === "shadow" && run.result === "waiting" ? "Shadow mode: no one is asked" : "Not needed", state: !asked ? (run.mode === "shadow" && run.result === "waiting" ? "skipped" : decision ? "skipped" : "todo") : run.state === "waiting" ? "current" : "done" },
    { label: "Result", detail: decision ? `${run.reason ?? decision.reason} Settled by: ${settledBy}.` : "Not decided yet", state: run.state === "decided" ? "done" : run.state === "waiting" ? "current" : "todo" },
  ];

  return (
    <DashboardPanel title={<h1 className="truncate font-semibold text-foreground">{run.repo}{run.pull ? ` #${run.pull}` : ""} <span className="font-mono text-sm text-muted-foreground">{shortSha(run.headSha)}</span></h1>}>
      <AutoRefresh everyMs={5000} />
      <PageBody>
        <div className="relative grid gap-4 overflow-hidden rounded-lg bg-background p-4 ring ring-border lg:grid-cols-[1fr_18rem]">
          {/* The beam reports real work: a worker is collecting or the council is answering right now. */}
          {working ? <BorderBeam size={120} duration={6} /> : null}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ResultBadge result={run.result} state={run.state} mode={run.mode} />
              <ModeBadge mode={run.mode} />
              {run.error ? <Badge color="error" variant="outline">{run.error}</Badge> : null}
            </div>
            <RunTimeline steps={steps} />
          </div>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Check run on GitHub</dt>
              <dd className="text-body">{run.checkRun ? ((run.checkRun as { sent: boolean; reason?: string }).sent ? "Posted" : `Not posted: ${(run.checkRun as { reason: string }).reason}`) : "Not posted yet"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Council cost</dt>
              <dd className="text-body">{dollars(run.costUsd)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Evidence record</dt>
              <dd className={chainOk ? "text-success" : "text-destructive"}>{chainOk ? `${evidence.length} entries, chain intact` : "Chain broken: an entry was edited or removed"}</dd>
            </div>
          </dl>
        </div>

        {decision?.hardFailures.map((f, i) => (
          <section key={i} className="space-y-2 rounded-lg bg-background p-4 ring ring-border">
            <h3 className="font-medium text-foreground">Hard failure: {f.workflow}{f.job ? ` / ${f.job}` : ""}</h3>
            <p className="text-sm text-body">{f.reason}</p>
            {f.logExcerpt ? <pre className="overflow-x-auto rounded bg-elevated p-3 font-mono text-xs text-body">{f.logExcerpt}</pre> : null}
          </section>
        ))}
        {questions.map((q) => (
          <QuestionCard key={q.question.id} q={q} ask={asks[q.question.id]} />
        ))}
        {run.notes.length ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {run.notes.map((n) => (
              <li key={n}>Note: {n}</li>
            ))}
          </ul>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Evidence record</h2>
          <ol className="divide-y overflow-hidden rounded-lg bg-background font-mono text-xs ring ring-border">
            {evidence.map((e) => (
              <li key={`${e.scope}-${e.seq}`} className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2">
                <span className="text-muted-foreground">#{e.seq}</span>
                <span className="text-foreground">{e.kind}</span>
                <span className="text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                <span className="min-w-0 flex-1 truncate text-body">{JSON.stringify(e.payload)}</span>
                <span className="text-muted-foreground" title={e.hash}>{e.hash.slice(0, 10)}</span>
              </li>
            ))}
          </ol>
        </section>
      </PageBody>
    </DashboardPanel>
  );
}
