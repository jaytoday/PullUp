import { useNavigate } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ArrowDown, ArrowUp } from "lucide-solid";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionBadge, BandBadge, RecBadge } from "@/components/shared/badges";
import { WaitMeter } from "@/components/shared/meters";
import { useRepo } from "@/components/layout/repo-context";
import type { PlannedReviewAction, PullDecision } from "@/lib/api";
import { cn } from "@/lib/cn";
import { withMode } from "@/lib/state";

type SortKey = "number" | "wait" | "risk" | "overdue";

const BAND_RANK: Record<string, number> = { escalate: 0, "review-with-rationale": 1, standard: 2, "fast-path": 3 };

export function PullTable(props: {
  decisions: readonly PullDecision[];
  actions: readonly PlannedReviewAction[];
  selected?: number;
}) {
  const repo = useRepo();
  const navigate = useNavigate();
  const [sort, setSort] = createSignal<{ key: SortKey; dir: 1 | -1 }>({ key: "risk", dir: 1 });
  const actionFor = (n: number) => props.actions.find((a) => a.pullNumber === n);

  const rows = createMemo(() => {
    const { key, dir } = sort();
    const v = (d: PullDecision): number =>
      key === "number"
        ? d.pullNumber
        : key === "wait"
          ? d.waitHours
          : key === "overdue"
            ? d.waitHours - d.maxWaitHours
            : (BAND_RANK[d.risk?.band ?? "standard"] ?? 2) * 1000 - (d.risk?.riskScore ?? 0) * 100;
    return [...props.decisions].sort((a, b) => dir * (v(a) - v(b)) || a.pullNumber - b.pullNumber);
  });

  const Sortable = (p: { k: SortKey; label: string; class?: string }) => (
    <TableHead class={p.class}>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => setSort((s) => ({ key: p.k, dir: s.key === p.k ? (s.dir === 1 ? -1 : 1) : 1 }))}
        aria-sort={sort().key === p.k ? (sort().dir === 1 ? "ascending" : "descending") : "none"}
      >
        {p.label}
        <Show when={sort().key === p.k}>{sort().dir === 1 ? <ArrowUp class="size-3" /> : <ArrowDown class="size-3" />}</Show>
      </button>
    </TableHead>
  );

  const open = (n: number) => navigate(withMode(`/r/${repo.repoId()}/pulls/${n}`, repo.mode()));

  return (
    <div class="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <Sortable k="number" label="PR" class="w-[38%] pl-4" />
            <Show when={repo.mode() !== "off"}>
              <Sortable k="risk" label="Band" />
            </Show>
            <Sortable k="overdue" label="Wait vs w*" />
            <TableHead>Recommendation</TableHead>
            <TableHead class="pr-4">Bot action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <For
            each={rows()}
            fallback={
              <TableRow>
                <TableCell colSpan={5} class="py-10 text-center text-sm text-muted-foreground">
                  No PRs match these filters.
                </TableCell>
              </TableRow>
            }
          >
            {(d) => (
              <TableRow
                class={cn("cursor-pointer", props.selected === d.pullNumber && "bg-accent/60")}
                onClick={() => open(d.pullNumber)}
                data-pr={d.pullNumber}
              >
                <TableCell class="pl-4">
                  <a
                    href={withMode(`/r/${repo.repoId()}/pulls/${d.pullNumber}`, repo.mode())}
                    onClick={(e) => {
                      e.preventDefault();
                      open(d.pullNumber);
                    }}
                    class="flex items-baseline gap-3 focus-visible:outline-none focus-visible:underline"
                  >
                    <span class="num w-11 shrink-0 text-xs text-muted-foreground">#{d.pullNumber}</span>
                    <span class="min-w-0">
                      <span class="block truncate font-medium">{d.title}</span>
                      <span class="block text-xs text-muted-foreground">
                        {d.changeType} · {d.area} · {d.author}
                      </span>
                    </span>
                  </a>
                </TableCell>
                <Show when={repo.mode() !== "off"}>
                  <TableCell>
                    <Show when={d.risk} fallback={<span class="text-xs text-muted-foreground">—</span>}>
                      {(r) => (
                        <div class="flex items-center gap-2">
                          <BandBadge band={r().band} />
                          <Show when={r().riskScore !== null}>
                            <span class="num text-xs text-muted-foreground">{(r().riskScore! * 100).toFixed(0)}%</span>
                          </Show>
                        </div>
                      )}
                    </Show>
                  </TableCell>
                </Show>
                <TableCell>
                  <WaitMeter wait={d.waitHours} wStar={d.maxWaitHours} shadowWStar={d.risk?.shadowMaxWaitHours} />
                </TableCell>
                <TableCell>
                  <div class="flex flex-col items-start gap-1">
                    <RecBadge rec={d.recommendation} />
                    <Show when={d.risk?.shadowRecommendation && d.risk.shadowRecommendation !== d.recommendation}>
                      <span class="text-[11px] text-band-review">active → {d.risk!.shadowRecommendation}</span>
                    </Show>
                  </div>
                </TableCell>
                <TableCell class="pr-4">
                  <Show when={actionFor(d.pullNumber)} fallback={<span class="text-xs text-muted-foreground">none</span>}>
                    {(a) => <ActionBadge action={a().action} />}
                  </Show>
                </TableCell>
              </TableRow>
            )}
          </For>
        </TableBody>
      </Table>
    </div>
  );
}
