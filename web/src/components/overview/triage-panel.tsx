import { For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { SegmentBar } from "@/components/charts/bar-list";
import { Panel } from "@/components/shared/panel";
import type { ReportResponse, SignalRunRecord } from "@/lib/api";
import { ago, humanize, usd } from "@/lib/format";
import { BAND_ORDER, BANDS } from "@/lib/meta";
import { withMode } from "@/lib/state";
import { useRepo } from "@/components/layout/repo-context";

/** Jev band distribution over open PRs + coverage + last run cost. */
export function TriagePanel(props: { data: ReportResponse; lastRun: SignalRunRecord | null }) {
  const repo = useRepo();
  const risk = () => props.data.report.risk;
  /** Questions most often ≥ 0.5 across open PRs' top signals. */
  const topSignals = () => {
    const counts = new Map<string, number>();
    for (const d of props.data.report.decisions) {
      if (d.state !== "open" || !d.risk) continue;
      for (const q of new Set(d.risk.topSignals.filter((t) => t.p >= 0.5).map((t) => t.question))) {
        counts.set(q, (counts.get(q) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4);
  };
  const count = (b: (typeof BAND_ORDER)[number]) => {
    const c = risk()?.counts;
    if (!c) return 0;
    return b === "escalate" ? c.escalate : b === "review-with-rationale" ? c.reviewWithRationale : b === "standard" ? c.standard : c.fastPath;
  };
  return (
    <Panel label="Jev triage · open PRs" href={withMode(`/r/${repo.repoId()}/pulls`, repo.mode())} class="lg:col-span-5">
      <Show
        when={risk()}
        fallback={<p class="text-sm text-muted-foreground">The Jev layer is off in this view. Switch to shadow or active to see risk bands.</p>}
      >
        {(r) => (
          <div class="space-y-4">
            <SegmentBar segments={BAND_ORDER.map((b) => ({ value: count(b), fill: BANDS[b].fill, label: BANDS[b].label }))} />
            <div class="grid grid-cols-2 gap-x-6 gap-y-2.5">
              <For each={BAND_ORDER}>
                {(b) => (
                  <div class="flex items-center justify-between text-sm">
                    <span class="flex items-center gap-2">
                      <Dynamic component={BANDS[b].icon} class={`size-3.5 ${BANDS[b].text}`} />
                      {BANDS[b].label}
                    </span>
                    <span class="num">{count(b)}</span>
                  </div>
                )}
              </For>
            </div>
            <Show when={topSignals().length > 0}>
              <div class="space-y-1.5 border-t border-border pt-3">
                <div class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Most frequent signals ≥ 0.5</div>
                <For each={topSignals()}>
                  {([q, n]) => (
                    <div class="flex items-center justify-between text-sm">
                      <span class={q === "addressesReviewerOrAutomation" ? "text-band-escalate" : ""}>
                        {q === "addressesReviewerOrAutomation" ? "Injection tripwire" : humanize(q)}
                      </span>
                      <span class="num text-xs text-muted-foreground">
                        {n} PR{n === 1 ? "" : "s"}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <span>
                Units evaluated <span class="num text-foreground">{r().units.evaluated}</span>/<span class="num">{r().units.total}</span>
              </span>
              <span>
                weights: <span class="text-foreground">{r().weightsSource}</span>
              </span>
              <Show when={props.lastRun}>
                {(run) => (
                  <span>
                    last run <span class="num text-foreground">{usd(run().costUsd)}</span> · {ago(run().runAt, Date.parse(props.data.report.generatedAt))}
                  </span>
                )}
              </Show>
            </div>
          </div>
        )}
      </Show>
    </Panel>
  );
}
