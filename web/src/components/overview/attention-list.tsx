import { A } from "@solidjs/router";
import { For, Show } from "solid-js";
import { BandBadge, RecBadge } from "@/components/shared/badges";
import { Panel } from "@/components/shared/panel";
import { useRepo } from "@/components/layout/repo-context";
import type { PullDecision } from "@/lib/api";
import { hours } from "@/lib/format";
import { withMode } from "@/lib/state";

const RANK: Record<string, number> = { escalate: 0, "review-with-rationale": 1, standard: 2, "fast-path": 3 };

/** Open PRs that most need a human, escalations first, then longest waits. */
export function AttentionList(props: { decisions: readonly PullDecision[] }) {
  const repo = useRepo();
  const rows = () =>
    props.decisions
      .filter((d) => d.state === "open")
      .sort(
        (a, b) =>
          (RANK[a.risk?.band ?? "standard"] ?? 2) - (RANK[b.risk?.band ?? "standard"] ?? 2) ||
          (a.recommendation === "request-changes" ? 0 : 1) - (b.recommendation === "request-changes" ? 0 : 1) ||
          b.waitHours - a.waitHours,
      )
      .slice(0, 6);
  return (
    <Panel label="Needs attention" href={withMode(`/r/${repo.repoId()}/pulls`, repo.mode())} class="lg:col-span-7" bodyClass="px-0 pb-1">
      <Show when={rows().length > 0} fallback={<p class="px-4 pb-3 text-sm text-muted-foreground">No open PRs.</p>}>
        <ul class="divide-y divide-border">
          <For each={rows()}>
            {(d) => (
              <li>
                <A
                  href={withMode(`/r/${repo.repoId()}/pulls/${d.pullNumber}`, repo.mode())}
                  class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                >
                  <span class="num w-12 shrink-0 text-xs text-muted-foreground">#{d.pullNumber}</span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm">{d.title}</span>
                    <span class="block truncate text-xs text-muted-foreground">
                      {d.changeType} · {d.area} · waited <span class="num">{hours(d.waitHours)}</span>
                      <Show when={d.risk?.escalateReasons[0] ?? d.risk?.reviewReasons[0]}>{(r) => <> · {r()}</>}</Show>
                    </span>
                  </span>
                  <Show when={d.risk} fallback={<RecBadge rec={d.recommendation} />}>
                    {(r) => <BandBadge band={r().band} />}
                  </Show>
                </A>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Panel>
  );
}
