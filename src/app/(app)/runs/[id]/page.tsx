import type { AskState } from "@pullup/engine";
import { notFound } from "next/navigation";
import { DashboardPanel, PageBody } from "@/components/app-shell/dashboard-panel";
import { AutoRefresh } from "@/components/common/auto-refresh";
import { BorderBeam } from "@/components/effects/border-beam";
import { Gauge } from "@/components/effects/gauge";
import { LogTerminal } from "@/components/runs/log-terminal";
import { QuestionCard } from "@/components/runs/question-card";
import { ModeBadge, ResultBadge } from "@/components/runs/result-badge";
import { RunTimeline, type TimelineStep } from "@/components/runs/run-timeline";
import { Badge } from "@/components/ui/badge";
import { dollars, shortSha } from "@/lib/format";
import { decisionOf } from "@/lib/run-decision";
import { decidedBy, runDetail } from "@/server/dashboard";

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
  const runtimeCalls = (decision?.councilCalls ?? 0) + (decision?.extensions?.screenCalls ?? 0);
  const counted = questions.filter((q) => !q.question.shadow);
  const shadow = questions.filter((q) => q.question.shadow);
  // One small heading per extension that raised something.
  const groups = [...new Set(counted.map((q) => q.question.extension))].map((e) => [e, counted.filter((q) => q.question.extension === e)] as const);
  const extensionNotes = decision?.extensions?.notes ?? [];
  const annotations = decision?.extensions?.annotations ?? [];
  const asked = Object.keys(asks).length;
  const seats = questions.flatMap((q) => q.seats);
  const answered = seats.filter((s) => !s.problems.some((p) => p.startsWith("call failed") || p.startsWith("answer has the wrong shape"))).length;

  const steps: TimelineStep[] = [
    { label: "Collect", detail: run.state === "collecting" ? `Waiting for ${run.pending.join(", ") || "the required workflows"}` : "Job results, reruns, logs and the diff collected", state: run.state === "collecting" ? "current" : "done" },
    { label: "Hard failures", detail: hard ? `${hard} hard failure${hard > 1 ? "s" : ""}: fail with no AI call` : "None", state: decision ? "done" : "todo" },
    { label: "Checks", detail: hard ? "Not needed" : counted.length ? `${counted.map((q) => q.question.id).join(", ")}${shadow.length ? ` (and ${shadow.length} in Shadow)` : ""}` : shadow.length ? `Only Shadow questions (${shadow.length}): pass` : "Nothing tricky: pass with no AI call", state: !decision ? "todo" : hard ? "skipped" : "done" },
    { label: "Decision runtime", detail: runtimeCalls ? `${runtimeCalls} decision call(s), ${dollars(run.costUsd)}` : "Not called", state: !decision ? "todo" : runtimeCalls ? "done" : "skipped" },
    { label: "Person", detail: asked ? settledBy : run.mode === "shadow" && run.result === "waiting" ? "Shadow mode: no one is asked" : "Not needed", state: !asked ? (run.mode === "shadow" && run.result === "waiting" ? "skipped" : decision ? "skipped" : "todo") : run.state === "waiting" ? "current" : "done" },
    { label: "Result", detail: decision ? `${run.reason ?? decision.reason} Settled by: ${settledBy}.` : "Not decided yet", state: run.state === "decided" ? "done" : run.state === "waiting" ? "current" : "todo" },
  ];

  return (
    <DashboardPanel title={<h1 className="truncate font-semibold text-foreground">{run.repo}{run.pull ? ` #${run.pull}` : ""} <span className="font-mono text-sm text-muted-foreground">{shortSha(run.headSha)}</span></h1>}>
      <AutoRefresh everyMs={5000} />
      <PageBody>
        <div className="relative grid gap-4 overflow-hidden rounded-lg bg-background p-4 ring ring-border lg:grid-cols-[1fr_18rem]">
          {/* The beam reports real work: a worker is collecting or the decision runtime is answering. */}
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
            {seats.length ? (
              <div className="flex items-center gap-3 pb-1">
                  <Gauge value={answered} max={seats.length} label={`${answered} of ${seats.length} decision answers received`} className="size-14 text-xs" />
                <dd className="text-xs text-muted-foreground">
                  {answered} of {seats.length} decision answers received
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs text-muted-foreground">Check run on GitHub</dt>
              <dd className="text-body">{run.checkRun ? ((run.checkRun as { sent: boolean; reason?: string }).sent ? "Posted" : `Not posted: ${(run.checkRun as { reason: string }).reason}`) : "Not posted yet"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Decision cost</dt>
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
            {f.logExcerpt ? <LogTerminal title={`${f.workflow}${f.job ? ` / ${f.job}` : ""}: end of the log`} log={f.logExcerpt} /> : null}
          </section>
        ))}
        {groups.map(([extension, list]) => (
          <section key={extension} className="space-y-3" data-testid={`extension-group-${extension}`}>
            <h2 className="font-mono text-xs text-muted-foreground">{extension}</h2>
            {list.map((q) => (
              <QuestionCard key={q.question.id} q={q} ask={asks[q.question.id]} />
            ))}
          </section>
        ))}
        {shadow.length ? (
          <section className="space-y-2 rounded-lg bg-background p-4 ring ring-border" data-testid="would-ask">
            <h2 className="text-sm font-medium text-foreground">Would ask (Shadow extensions, not counted)</h2>
            <p className="text-xs text-muted-foreground">These extensions are trying out in Shadow mode: their questions went to AskWithAI so its answers can be measured, but they never change the result and no one is asked.</p>
            <ul className="space-y-1 text-sm">
              {shadow.map((q) => (
                <li key={q.question.id} className="flex flex-wrap gap-x-2">
                  <span className="font-mono text-xs text-muted-foreground">{q.question.id}</span>
                  <span className="text-body">{q.question.summary}</span>
                  <span className="text-xs text-muted-foreground">(runtime: {q.outcome === "ask" ? "would ask a person" : q.outcome})</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {extensionNotes.length || annotations.length ? (
          <section className="space-y-2 rounded-lg bg-background p-4 ring ring-border" data-testid="extension-notes">
            <h2 className="text-sm font-medium text-foreground">For the reviewer</h2>
            <ul className="space-y-1 text-sm text-body">
              {extensionNotes.map((n, i) => (
                <li key={`n${i}`}>
                  {n.link ? (
                    <a href={n.link} className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
                      {n.text}
                    </a>
                  ) : (
                    n.text
                  )}{" "}
                  <span className="font-mono text-xs text-muted-foreground">{n.extension}</span>
                </li>
              ))}
              {annotations.map((a, i) => (
                <li key={`a${i}`}>
                  <span className="font-mono text-xs">
                    {a.path}:{a.line}
                  </span>{" "}
                  {a.message} <span className="font-mono text-xs text-muted-foreground">{a.extension}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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
