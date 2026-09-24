import { createResource, For, Show } from "solid-js";
import { Check, FlaskConical, X } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyIcon, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { BarList } from "@/components/charts/bar-list";
import { ReliabilityChart } from "@/components/charts/reliability-chart";
import { Figure, Panel } from "@/components/shared/panel";
import { PageHeader, PageSkeleton } from "@/components/layout/repo-layout";
import { useRepo } from "@/components/layout/repo-context";
import { api, type CalibrationArtifact } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime, devHours, humanize, num } from "@/lib/format";
import { safeLatest } from "@/lib/state";

type Gate = CalibrationArtifact["gate"];

function GateList(props: { title: string; gate: Gate; note: string }) {
  return (
    <Panel
      label={props.title}
      aside={
        <span
          class={cn(
            "rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
            props.gate.passed ? "border-band-fast/40 text-band-fast" : "border-band-escalate/40 text-band-escalate",
          )}
        >
          {props.gate.passed ? "PASSED" : "FAILED"}
        </span>
      }
    >
      <ul class="space-y-2">
        <For each={props.gate.checks}>
          {(c) => (
            <li class="flex items-center gap-2.5 text-sm">
              <span class={cn("flex size-4 items-center justify-center rounded-full", c.passed ? "bg-band-fast/15 text-band-fast" : "bg-band-escalate/15 text-band-escalate")}>
                {c.passed ? <Check class="size-3" /> : <X class="size-3" />}
              </span>
              <span class="flex-1">{c.name}</span>
              <span class="num text-xs">
                <span class={c.passed ? "text-foreground" : "text-band-escalate"}>{c.value === null ? "—" : num(c.value, c.value % 1 ? 3 : 0)}</span>
                <span class="text-muted-foreground"> / {c.threshold}</span>
              </span>
            </li>
          )}
        </For>
      </ul>
      <p class="mt-3 text-xs text-muted-foreground">{props.note}</p>
    </Panel>
  );
}

export default function Calibration() {
  const repo = useRepo();
  const [cal] = createResource(() => ({ id: repo.repoId(), v: repo.version() }), (k) => api.calibration(k.id));

  const runButton = (
    <Button onClick={() => void repo.calibrate()} disabled={repo.busy() !== null}>
      <Show when={repo.busy() === "Calibration"} fallback={<FlaskConical class="size-4" />}>
        <Spinner size="sm" />
      </Show>
      Run calibration
    </Button>
  );

  return (
    <div class="space-y-5">
      <PageHeader
        title="Calibration"
        description="Fits the Jev risk model on this repo's own history (merged PRs that later shipped a defect proxy) and gates whether it may move P(defect)."
        actions={runButton}
      />
      <Show when={cal.state !== "pending" || safeLatest(cal) !== undefined} fallback={<PageSkeleton />}>
        <Show
          when={safeLatest(cal)?.artifact ? { path: safeLatest(cal)!.path, artifact: safeLatest(cal)!.artifact! } : undefined}
          fallback={
            <Empty class="border-border bg-card/50">
              <EmptyIcon>
                <FlaskConical />
              </EmptyIcon>
              <EmptyTitle>No calibration artifact yet</EmptyTitle>
              <EmptyDescription>
                Run calibration here or with <code class="num text-foreground">pullup calibrate {repo.repoId()}</code>. Until one passes its gate, the
                risk multiplier stays at 1.
              </EmptyDescription>
            </Empty>
          }
        >
          {(c) => {
            const a = () => c().artifact;
            const m = () => a().metrics;
            return (
              <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <Panel label="Labelled history">
                    <Figure value={a().labelled.withSignals} caption={<>{a().labelled.defects} shipped a defect proxy</>} />
                  </Panel>
                  <Panel label="AUROC · out of fold">
                    <Figure value={num(m().fitted.auroc, 3)} tone="text-primary" caption={<>uncalibrated {num(m().uncalibrated.auroc, 3)}</>} />
                  </Panel>
                  <Panel label="Adaptive ECE">
                    <Figure
                      value={num(m().fitted.ece, 3)}
                      tone={m().fitted.ece <= 0.05 ? "text-band-fast" : "text-band-review"}
                      caption={<>uncalibrated {num(m().uncalibrated.ece, 3)} · lower is better</>}
                    />
                  </Panel>
                  <Panel label="Backtest vs rules-only">
                    <Figure
                      value={`${a().backtest.deltaHours > 0 ? "+" : ""}${num(a().backtest.deltaHours, 0)}`}
                      unit="dev-h"
                      tone={a().backtest.deltaHours <= 0 ? "text-band-fast" : "text-band-escalate"}
                      caption={<>{devHours(a().backtest.withJevCostHours)} vs {devHours(a().backtest.rulesOnlyCostHours)}</>}
                    />
                  </Panel>
                </div>

                <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <GateList title="Multiplier gate" gate={a().gate} note="Must pass before calibrated risk may raise P(defect). The multiplier is never below 1." />
                  <GateList
                    title="Fast-path gate"
                    gate={a().fastPathGate}
                    note="The bar for ever un-stubbing approval. Fast-path decisions stay logged-only until a live actuator is explicitly enabled."
                  />
                </div>

                <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <Panel label="Reliability · predicted vs observed" class="lg:col-span-5">
                    <div class="flex flex-col items-center gap-2">
                      <ReliabilityChart bins={m().reliability} />
                      <p class="text-xs text-muted-foreground">Dots on the dashed diagonal are perfectly calibrated · area ∝ bin size</p>
                    </div>
                  </Panel>
                  <Panel label="Per-feature AUROC (0.5 = no signal)" class="lg:col-span-7">
                    <BarList
                      max={1}
                      reference={{ at: 0.5, label: "chance" }}
                      rows={Object.entries(m().perFeatureAuroc)
                        .sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))
                        .map(([f, v]) => ({
                          label: <span class="text-xs">{humanize(f.replace(/^max:/, ""))}</span>,
                          value: v ?? 0,
                          display: num(v, 3),
                          fill: (v ?? 0) >= 0.6 ? "bg-primary" : "bg-band-standard/60",
                        }))}
                    />
                  </Panel>
                </div>

                <Panel label="Artifact">
                  <dl class="num grid grid-cols-2 gap-x-6 gap-y-2 text-xs md:grid-cols-4">
                    <div>
                      <dt class="text-muted-foreground">hash</dt>
                      <dd>{a().hash}</dd>
                    </div>
                    <div>
                      <dt class="text-muted-foreground">model · questions</dt>
                      <dd>
                        {a().modelId} · {a().questionSetVersion}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-muted-foreground">created</dt>
                      <dd>{dateTime(a().createdAt)}</dd>
                    </div>
                    <div>
                      <dt class="text-muted-foreground">path</dt>
                      <dd class="truncate" title={c().path}>
                        {c().path}
                      </dd>
                    </div>
                  </dl>
                </Panel>
              </div>
            );
          }}
        </Show>
      </Show>
    </div>
  );
}
