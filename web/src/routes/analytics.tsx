import { For } from "solid-js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AreaChart } from "@/components/charts/area-chart";
import { BarList } from "@/components/charts/bar-list";
import { Figure, Panel } from "@/components/shared/panel";
import { PageHeader, WithReport } from "@/components/layout/repo-layout";
import { hours, num, pct } from "@/lib/format";

/** Thin inline rate bar for table cells. */
function Rate(props: { value: number | null; fill: string }) {
  return (
    <div class="flex items-center gap-2">
      <div class="h-1.5 w-16 rounded-full bg-secondary">
        <div class={`h-full rounded-full ${props.fill}`} style={{ width: `${(props.value ?? 0) * 100}%` }} />
      </div>
      <span class="num w-12 text-xs">{pct(props.value, 0)}</span>
    </div>
  );
}

export default function Analytics() {
  return (
    <WithReport>
      {(data) => {
        const a = data.report.analytics;
        const lat = a.latency;
        const latencyRows = [
          ["Time to first review", lat.timeToFirstReviewHours],
          ["Total review time", lat.totalReviewHours],
          ["Wait (open → merge/close)", lat.waitHours],
        ] as const;
        return (
          <div class="space-y-5">
            <PageHeader title="Analytics" description="The measured inputs behind the two-cost model, from this repo's own PR history." />

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <Panel label="Review latency" class="lg:col-span-7" bodyClass="px-0 pb-1">
                <Table>
                  <TableHeader>
                    <TableRow class="hover:bg-transparent">
                      <TableHead class="pl-4">Dimension</TableHead>
                      <TableHead class="text-right">n</TableHead>
                      <TableHead class="text-right">p10</TableHead>
                      <TableHead class="text-right">p50</TableHead>
                      <TableHead class="pr-4 text-right">p90</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <For each={latencyRows}>
                      {([label, s]) => (
                        <TableRow>
                          <TableCell class="pl-4">{label}</TableCell>
                          <TableCell class="num text-right text-muted-foreground">{s.n}</TableCell>
                          <TableCell class="num text-right">{hours(s.p10)}</TableCell>
                          <TableCell class="num text-right text-primary">{hours(s.p50)}</TableCell>
                          <TableCell class="num pr-4 text-right">{hours(s.p90)}</TableCell>
                        </TableRow>
                      )}
                    </For>
                  </TableBody>
                </Table>
              </Panel>
              <Panel label="Time to first review · p50 by area" class="lg:col-span-5">
                <BarList
                  rows={Object.entries(lat.byArea)
                    .sort((x, y) => (y[1].p50 ?? 0) - (x[1].p50 ?? 0))
                    .map(([area, s]) => ({ label: area, value: s.p50 ?? 0, display: `${hours(s.p50)} · n=${s.n}` }))}
                />
              </Panel>
            </div>

            <Panel label="Outcomes by wait bucket" bodyClass="px-0 pb-1">
              <Table>
                <TableHeader>
                  <TableRow class="hover:bg-transparent">
                    <TableHead class="pl-4">Wait ≥</TableHead>
                    <TableHead class="text-right">n</TableHead>
                    <TableHead>Approval rate</TableHead>
                    <TableHead>Changes requested</TableHead>
                    <TableHead class="pr-4">Shipped a defect</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <For each={a.outcomes.buckets}>
                    {(b) => (
                      <TableRow>
                        <TableCell class="num pl-4">{hours(b.bucketHours, 0)}</TableCell>
                        <TableCell class="num text-right text-muted-foreground">{b.n}</TableCell>
                        <TableCell>
                          <Rate value={b.approvalRate} fill="bg-primary" />
                        </TableCell>
                        <TableCell>
                          <Rate value={b.changesRequestedRate} fill="bg-clay" />
                        </TableCell>
                        <TableCell class="pr-4">
                          <Rate value={b.shippedDefectRate} fill="bg-band-escalate" />
                        </TableCell>
                      </TableRow>
                    )}
                  </For>
                </TableBody>
              </Table>
              <p class="px-4 pt-2 text-xs text-muted-foreground">
                Correlation of wait with approval <span class="num">{num(a.outcomes.approvalVsWaitCorrelation, 3)}</span> · with changes requested{" "}
                <span class="num">{num(a.outcomes.changesRequestedVsWaitCorrelation, 3)}</span>
              </p>
            </Panel>

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <Panel label="Defect proxies by change type" class="lg:col-span-5">
                <BarList
                  max={Math.max(0.05, ...Object.values(a.defects.byChangeType).map((r) => r.rate ?? 0))}
                  rows={Object.entries(a.defects.byChangeType).map(([t, r]) => ({
                    label: t,
                    value: r.rate ?? 0,
                    display: `${pct(r.rate)} · ${r.defects}/${r.n}`,
                    fill: "bg-band-escalate/80",
                  }))}
                />
              </Panel>
              <Panel label="Review efficacy" class="lg:col-span-3">
                <div class="space-y-4">
                  <Figure value={pct(a.efficacy.eMax)} tone="text-primary" caption="of ship-risk removed at full review" />
                  <div class="space-y-1.5 text-sm">
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">Defects with findings</span>
                      <span class="num">{pct(a.efficacy.withFindings.rate)}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">Defects without</span>
                      <span class="num">{pct(a.efficacy.withoutFindings.rate)}</span>
                    </div>
                  </div>
                </div>
              </Panel>
              <Panel label="Queue depth κ (daily)" class="lg:col-span-4">
                <AreaChart
                  points={a.congestion.points.map((p) => ({ x: p.day.slice(5), y: p.queueDepth }))}
                  reference={1}
                  format={(v) => v.toFixed(2)}
                />
                <p class="mt-2 text-xs text-muted-foreground">
                  mean <span class="num">{num(a.congestion.meanQueueDepth, 2)}</span> · dashed line κ = 1 (one PR per active reviewer)
                </p>
              </Panel>
            </div>
          </div>
        );
      }}
    </WithReport>
  );
}
