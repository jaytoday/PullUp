import { A } from "@solidjs/router";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { History, Send, ShieldCheck } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyIcon, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ActionBadge } from "@/components/shared/badges";
import { Panel } from "@/components/shared/panel";
import { PageHeader, PageSkeleton } from "@/components/layout/repo-layout";
import { useRepo } from "@/components/layout/repo-context";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime, shortSha } from "@/lib/format";
import { ACTIONS, type BotAction } from "@/lib/meta";
import { safeLatest, withMode } from "@/lib/state";

export default function Actions() {
  const repo = useRepo();
  const [filter, setFilter] = createSignal<string>("all");
  const [logged] = createResource(() => ({ id: repo.repoId(), v: repo.version() }), (k) => api.actions(k.id));
  const titles = createMemo(
    () => new Map((safeLatest(repo.report)?.report.decisions ?? []).map((d) => [d.pullNumber, d.title])),
  );
  const rows = () => (safeLatest(logged) ?? []).filter((a) => filter() === "all" || a.action === filter());
  const count = (a: BotAction) => (safeLatest(logged) ?? []).filter((x) => x.action === a).length;

  return (
    <div class="space-y-5">
      <PageHeader
        title="Review actions"
        description="What the review bot decided, as GitHub pull-request reviews. Approval authority is stubbed: each call is recorded exactly and nothing is sent."
        actions={
          <Button onClick={() => void repo.logActions()} disabled={repo.busy() !== null}>
            <Show when={repo.busy() === "Log review actions"} fallback={<Send class="size-4" />}>
              <Spinner size="sm" />
            </Show>
            Log current actions
          </Button>
        }
      />

      <div class="flex items-center gap-3 rounded-lg border border-primary/25 bg-primary/6 px-4 py-3 text-sm">
        <ShieldCheck class="size-4 shrink-0 text-primary" />
        <span>
          <span class="font-medium">0 sent to GitHub.</span>{" "}
          <span class="text-muted-foreground">
            Logged calls use <code class="num">pulls.createReview</code> (APPROVE / REQUEST_CHANGES / COMMENT) and{" "}
            <code class="num">pulls.requestReviewers</code> for deferrals. A live actuator is a separate, explicit enablement.
          </span>
        </span>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <For each={Object.keys(ACTIONS) as BotAction[]}>
          {(a) => (
            <Panel label={ACTIONS[a].label}>
              <div class="flex items-end justify-between">
                <span class={cn("num text-3xl font-medium", ACTIONS[a].text)}>{count(a)}</span>
                <span class="num text-xs text-muted-foreground">{ACTIONS[a].event}</span>
              </div>
            </Panel>
          )}
        </For>
      </div>

      <Show when={!logged.loading || safeLatest(logged)} fallback={<PageSkeleton />}>
        <Show
          when={(safeLatest(logged) ?? []).length > 0}
          fallback={
            <Empty class="border-border bg-card/50">
              <EmptyIcon>
                <History />
              </EmptyIcon>
              <EmptyTitle>No review actions logged yet</EmptyTitle>
              <EmptyDescription>Run signals, then log the current actions — escalations defer to a human, TCM decisions approve or request changes.</EmptyDescription>
            </Empty>
          }
        >
          <div class="flex items-center gap-3">
            <ToggleGroup type="single" size="sm" value={filter()} onChange={(v) => setFilter(v || "all")} aria-label="Filter actions">
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <For each={Object.keys(ACTIONS) as BotAction[]}>{(a) => <ToggleGroupItem value={a}>{ACTIONS[a].label}</ToggleGroupItem>}</For>
            </ToggleGroup>
          </div>
          <ol class="relative space-y-0 border-l border-border pl-6" aria-label="Logged review actions">
            <For each={rows()}>
              {(a) => (
                <li class="relative pb-5 last:pb-0" data-action={a.action} data-pr={a.pullNumber}>
                  <span class={cn("absolute -left-[33px] top-1 flex size-4 items-center justify-center rounded-full border-2 border-background", ACTIONS[a.action].fill)}>
                    <Dynamic component={ACTIONS[a.action].icon} class="size-2.5 text-background" />
                  </span>
                  <div class="rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-input">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="flex min-w-0 items-center gap-2.5">
                        <ActionBadge action={a.action} tip={false} />
                        <A
                          href={withMode(`/r/${repo.repoId()}/pulls/${a.pullNumber}`, repo.mode())}
                          class="truncate text-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:underline"
                        >
                          <span class="num text-muted-foreground">#{a.pullNumber}</span> {titles().get(a.pullNumber) ?? ""}
                        </A>
                      </div>
                      <span class="num text-xs text-muted-foreground">{dateTime(a.loggedAt)}</span>
                    </div>
                    <p class="mt-2 text-sm text-muted-foreground">{a.reason}</p>
                    <div class="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>event {a.call.createReview.event}</span>
                      <span>commit {shortSha(a.headSha)}</span>
                      <span>source {a.source}</span>
                      <Show when={a.call.requestReviewers}>{(r) => <span>reviewers {r().reviewers.join(", ")}</span>}</Show>
                      <span class="text-band-review">status {a.status}</span>
                    </div>
                  </div>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </Show>
    </div>
  );
}
