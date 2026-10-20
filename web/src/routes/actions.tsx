import { A } from "@solidjs/router";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { FileSearch, History, Send, ShieldCheck } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyIcon, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ActionBadge } from "@/components/shared/badges";
import { AuthorityPill } from "@/components/shared/authority-pill";
import { Panel } from "@/components/shared/panel";
import { PageHeader, PageSkeleton } from "@/components/layout/repo-layout";
import { useRepo } from "@/components/layout/repo-context";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime, shortSha } from "@/lib/format";
import { ACTIONS, type BotAction } from "@/lib/meta";
import { safeLatest, withMode } from "@/lib/state";
import { DeliveryStatus } from "@/components/shared/delivery-status";
import { AuthorityPanel } from "@/components/authority/authority-panel";
import { EvidenceSheet } from "@/components/authority/evidence-sheet";

export default function Actions() {
  const repo = useRepo();
  const [filter, setFilter] = createSignal<string>("all");
  const [evidenceFor, setEvidenceFor] = createSignal<string | null>(null);
  const [logged] = createResource(() => ({ id: repo.repoId(), v: repo.version() }), (k) => api.actions(k.id));
  const titles = createMemo(
    () => new Map((safeLatest(repo.report)?.report.decisions ?? []).map((d) => [d.pullNumber, d.title])),
  );
  const rows = () => (safeLatest(logged) ?? []).filter((a) => filter() === "all" || a.action === filter());
  const count = (a: BotAction) => (safeLatest(logged) ?? []).filter((x) => x.action === a).length;
  const sentCount = () => (safeLatest(logged) ?? []).filter((x) => x.status === "sent").length;

  return (
    <div class="space-y-5">
      <PageHeader
        title="Review actions"
        description="What the review bot decided, shaped by the repo's action mode (act · comment only · silent), then authorized separately: the repo's profile, this PullUp version's approval and the stop switch decide what may actually be sent."
        actions={
          <Button onClick={() => void repo.logActions()} disabled={repo.busy() !== null}>
            <Show when={repo.busy() === "Log review actions"} fallback={<Send class="size-4" />}>
              <Spinner size="sm" />
            </Show>
            Log current actions
          </Button>
        }
      />

      <AuthorityPanel repoId={repo.repoId()} version={repo.version()} />

      <div class="flex items-center gap-3 rounded-lg border border-primary/25 bg-primary/6 px-4 py-3 text-sm">
        <ShieldCheck class="size-4 shrink-0 text-primary" />
        <span>
          <span class="font-medium" data-testid="sent-count">{sentCount()} sent to GitHub.</span>{" "}
          <span class="text-muted-foreground">
            Acting calls use <code class="num">pulls.createReview</code> (APPROVE / REQUEST_CHANGES) and{" "}
            <code class="num">pulls.requestReviewers</code>; comment-only actions become one PullUp comment per PR, edited in place. With checks on, each action also posts one PullUp check run per commit. Sending
            needs live delivery (an operator setting), a signed 5-minute permit per action and a token scoped to this repo, revoked right after.
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
                        <Show when={a.authority}>{(l) => <AuthorityPill level={l()} />}</Show>
                        <Show when={a.authorization && a.authorization.decision !== "allow"}>
                          <span
                            class="num rounded border border-band-review/40 px-1.5 py-0.5 text-[10px] text-band-review"
                            title={a.authorization!.reasons.join("\n")}
                            data-authorization={a.authorization!.decision}
                          >
                            {a.authorization!.decision === "deny" ? "no authority" : "profile: comment only"}
                          </span>
                        </Show>
                        <A
                          href={withMode(`/r/${repo.repoId()}/pulls/${a.pullNumber}`, repo.mode())}
                          class="truncate text-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:underline"
                        >
                          <span class="num text-muted-foreground">#{a.pullNumber}</span> {titles().get(a.pullNumber) ?? ""}
                        </A>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="num text-xs text-muted-foreground">{dateTime(a.loggedAt)}</span>
                        <Show when={a.taskId}>
                          <Button variant="ghost" size="xs" onClick={() => setEvidenceFor(a.taskId!)} data-testid="open-evidence">
                            <FileSearch class="size-3.5" />
                            Evidence
                          </Button>
                        </Show>
                      </div>
                    </div>
                    <p class="mt-2 text-sm text-muted-foreground">{a.reason}</p>
                    <div class="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{a.call.createReview ? `event ${a.call.createReview.event}` : a.call.upsertComment ? "PullUp comment" : "no call"}</span>
                      <span>commit {shortSha(a.headSha)}</span>
                      <span>source {a.source}</span>
                      <Show when={a.call.requestReviewers}>{(r) => <span>reviewers {r().reviewers.join(", ")}</span>}</Show>
                      <Show when={a.configVersion}>{(v) => <span>config v{v()}</span>}</Show>
                      <Show when={a.call.checkRun}>
                        {(c) => (
                          <span data-testid="check-run" data-conclusion={c().conclusion} title={c().output.title}>
                            check {c().name}: {c().conclusion}
                            {c().output.annotations.length > 0 ? ` · ${c().output.annotations.length} annotation${c().output.annotations.length === 1 ? "" : "s"}` : ""}
                            {a.delivery?.checkRunId ? ` · #${a.delivery.checkRunId}` : ""}
                          </span>
                        )}
                      </Show>
                      <DeliveryStatus record={a} />
                    </div>
                    <Show when={a.delivery?.errors?.length || a.delivery?.skipped || a.delivery?.denied?.length}>
                      <p class="mt-1.5 text-xs text-muted-foreground">
                        {a.delivery?.errors?.join(" · ") ?? a.delivery?.denied?.join(" · ") ?? a.delivery?.skipped}
                      </p>
                    </Show>
                    <Show when={a.authorization && a.authorization.decision !== "allow" && a.status !== "denied"}>
                      <p class="mt-1.5 text-xs text-muted-foreground">{a.authorization!.reasons.join(" ")}</p>
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </Show>
      <EvidenceSheet taskId={evidenceFor()} onClose={() => setEvidenceFor(null)} />
    </div>
  );
}
