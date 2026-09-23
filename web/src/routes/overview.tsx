import { createResource, For, Show } from "solid-js";
import { AreaChart } from "@/components/charts/area-chart";
import { BarList } from "@/components/charts/bar-list";
import { PageHeader, ReportNotes, WithReport } from "@/components/layout/repo-layout";
import { useRepo } from "@/components/layout/repo-context";
import { ActionsPanel } from "@/components/overview/actions-panel";
import { AttentionList } from "@/components/overview/attention-list";
import { TriagePanel } from "@/components/overview/triage-panel";
import { Dot } from "@/components/shared/badges";
import { Figure, Panel } from "@/components/shared/panel";
import { api } from "@/lib/api";
import { hours, num, pct } from "@/lib/format";
import { RECOMMENDATIONS, type Recommendation } from "@/lib/meta";
import { safeLatest, withMode } from "@/lib/state";

function loadLevel(k: number | null): { label: string; dot: string } {
  if (k === null) return { label: "no data", dot: "bg-border" };
  if (k >= 2) return { label: "congested", dot: "bg-band-escalate" };
  if (k >= 1) return { label: "busy", dot: "bg-band-review" };
  return { label: "healthy", dot: "bg-band-fast" };
}

const REC_ORDER: readonly Recommendation[] = ["escalate", "request-changes", "keep-reviewing", "auto-approve"];

export default function Overview() {
  const repo = useRepo();
  const [runs] = createResource(() => ({ id: repo.repoId(), v: repo.version() }), (k) => api.signalRuns(k.id));

  return (
    <WithReport>
      {(data) => {
        const r = data.report;
        const open = () => r.decisions.filter((d) => d.state === "open");
        const recCount = (rec: Recommendation) => open().filter((d) => d.recommendation === rec).length;
        const level = loadLevel(r.summary.congestionQueueDepth);
        const latency = r.analytics.latency.timeToFirstReviewHours;
        const defects = r.analytics.defects.overall;
        const types = Object.entries(data.maxWaitByType).sort((a, b) => b[1] - a[1]);
        return (
          <div class="space-y-5">
            <PageHeader
              title="Overview"
              description={
                <>
                  How long should a PR wait for human review before shipping it is cheaper? {r.pulls.total} PRs · {r.pulls.merged} merged ·{" "}
                  {open().length} open.
                </>
              }
            />
            <ReportNotes />

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Panel label="Review load">
                <Figure value={num(r.summary.congestionQueueDepth, 2)} unit="κ" caption={<Dot class={level.dot} label={level.label} />} />
              </Panel>
              <Panel label="Time to first review">
                <Figure value={hours(latency.p50)} caption={<>p90 <span class="num">{hours(latency.p90)}</span> · n={latency.n}</>} />
              </Panel>
              <Panel label="Shipping risk">
                <Figure
                  value={pct(defects.rate)}
                  tone={defects.rate !== null && defects.rate > 0.1 ? "text-clay" : undefined}
                  caption={<>{defects.defects}/{defects.n} merged shipped a defect proxy</>}
                />
              </Panel>
              <Panel label="Review efficacy">
                <Figure value={pct(r.params.eMax)} tone="text-primary" caption="of ship-risk removed by full review" />
              </Panel>
            </div>

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <TriagePanel data={data} lastRun={safeLatest(runs)?.[0] ?? null} />
              <Panel label="Max wait w* by change type" class="lg:col-span-4">
                <BarList
                  rows={types.map(([t, w]) => ({
                    label: t,
                    value: w,
                    display: hours(w),
                    fill: w <= 2 ? "bg-band-fast" : "bg-primary",
                  }))}
                />
              </Panel>
              <Panel label="Recommendations" href={withMode(`/r/${repo.repoId()}/pulls`, repo.mode())} class="lg:col-span-3">
                <ul class="space-y-2.5">
                  <For each={REC_ORDER}>
                    {(rec) => (
                      <li class="flex items-center justify-between text-sm">
                        <span class={`flex items-center gap-2 ${RECOMMENDATIONS[rec].text}`}>
                          <span class={`size-1.5 rounded-full ${RECOMMENDATIONS[rec].fill}`} />
                          <span class="text-foreground">{RECOMMENDATIONS[rec].label}</span>
                        </span>
                        <span class="num">{recCount(rec)}</span>
                      </li>
                    )}
                  </For>
                </ul>
                <p class="mt-4 text-xs text-muted-foreground">Recommendations only — PullUp enforces nothing.</p>
              </Panel>
            </div>

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <AttentionList decisions={r.decisions} />
              <ActionsPanel planned={data.actions} />
            </div>

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <Panel label="Review queue depth (daily)" href={withMode(`/r/${repo.repoId()}/analytics`, repo.mode())} class="lg:col-span-7">
                <Show when={r.analytics.congestion.points.length > 1} fallback={<p class="text-sm text-muted-foreground">Not enough history.</p>}>
                  <AreaChart
                    points={r.analytics.congestion.points.map((p) => ({ x: p.day.slice(5), y: p.queueDepth }))}
                    reference={1}
                    format={(v) => `κ ${v.toFixed(2)}`}
                  />
                </Show>
              </Panel>
              <Panel label="Two-cost parameters" class="lg:col-span-5">
                <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt class="text-xs text-muted-foreground">Waiting cost rate r_v</dt>
                    <dd class="num">{num(r.params.valueDelayRatePerHour, 3)} h/h</dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted-foreground">Defect cost C_defect</dt>
                    <dd class="num">{hours(r.params.defectReworkHours * r.params.escalationMultiplier, 0)}</dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted-foreground">Review window T_review</dt>
                    <dd class="num">{hours(r.params.reviewWindowHours, 0)}</dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted-foreground">Cold-start after</dt>
                    <dd class="num">{hours(r.params.coldStartThresholdHours, 0)}</dd>
                  </div>
                </dl>
              </Panel>
            </div>
          </div>
        );
      }}
    </WithReport>
  );
}
