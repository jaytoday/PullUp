import { A, useNavigate } from "@solidjs/router";
import { createResource, createSignal, For, Show } from "solid-js";
import { Lightbulb, X } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyIcon, EmptyTitle } from "@/components/ui/empty";
import { showToast } from "@/components/ui/toast";
import { Panel } from "@/components/shared/panel";
import { PageHeader, PageSkeleton } from "@/components/layout/repo-layout";
import { useRepo } from "@/components/layout/repo-context";
import { api, type DecisionOutcome, type Learning } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime, pct, shortSha } from "@/lib/format";
import { safeLatest, withMode } from "@/lib/state";

const OUTCOME: Record<DecisionOutcome["outcome"], { label: string; cls: string }> = {
  "human-agreed-approve": { label: "approval held", cls: "text-band-fast" },
  "human-overrode-approve": { label: "approval overridden", cls: "text-band-escalate" },
  "ask-unneeded": { label: "ask not needed", cls: "text-band-review" },
  "ask-useful": { label: "ask was useful", cls: "text-band-fast" },
  "ask-approved": { label: "approved later", cls: "text-muted-foreground" },
  "changes-addressed": { label: "changes addressed", cls: "text-band-fast" },
  "changes-overridden": { label: "change request overridden", cls: "text-band-review" },
  closed: { label: "closed", cls: "text-muted-foreground" },
  pending: { label: "pending", cls: "text-muted-foreground" },
};

const KIND_LABEL: Record<Learning["kind"], string> = {
  "over-escalation": "Asks humans too often",
  "confirmed-pattern": "Usually right",
  "missed-risk": "Approvals that went wrong",
  "review-guidance": "Where reviewers find things",
};

function LearningCard(props: { l: Learning; onDismiss: () => void; draftHref: string }) {
  const navigate = useNavigate();
  return (
    <div class={cn("space-y-2 rounded-lg border border-border bg-card px-4 py-3", props.l.status === "dismissed" && "opacity-60")} data-learning={props.l.id} data-kind={props.l.kind}>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <Lightbulb class="size-4 text-primary" />
          <span class="text-sm font-medium">{KIND_LABEL[props.l.kind]}</span>
          <span class="num text-xs text-muted-foreground">{props.l.pathFamily}</span>
          <Show when={props.l.status === "dismissed"}>
            <span class="rounded border border-border px-1 text-[10px] text-muted-foreground">dismissed</span>
          </Show>
        </div>
        <div class="flex items-center gap-1.5">
          <Show when={props.l.suggestion.ops.length > 0 && props.l.status === "suggested"}>
            <Button size="xs" variant="secondary" onClick={() => navigate(props.draftHref)} data-testid="open-draft">
              Open as draft
            </Button>
          </Show>
          <Show when={props.l.status === "suggested"}>
            <Button size="xs" variant="ghost" onClick={props.onDismiss} data-testid="dismiss-learning">
              <X class="size-3.5" /> Dismiss
            </Button>
          </Show>
        </div>
      </div>
      <p class="text-sm">{props.l.summary}</p>
      <p class="text-xs text-muted-foreground">{props.l.suggestion.text}</p>
      <p class="num text-[11px] text-muted-foreground">
        evidence: {props.l.evidence.support} of {props.l.evidence.total} pull requests ({pct(props.l.evidence.rate)})
        {props.l.evidence.baseline !== null ? ` · repo baseline ${pct(props.l.evidence.baseline)}` : ""} · #{props.l.evidence.pulls.slice(0, 12).join(", #")}
        {props.l.evidence.pulls.length > 12 ? " …" : ""}
      </p>
    </div>
  );
}

export default function Outcomes() {
  const repo = useRepo();
  const [bump, setBump] = createSignal(0);
  const [data] = createResource(() => ({ id: repo.repoId(), v: repo.version(), b: bump() }), (k) => api.outcomes(k.id));
  const d = () => safeLatest(data);
  // withMode adds `?mode=` only off the default mode; the learning id joins it.
  const draftHref = (id: string) => {
    const base = withMode(`/r/${repo.repoId()}/settings`, repo.mode());
    return `${base}${base.includes("?") ? "&" : "?"}learning=${id}`;
  };
  const dismiss = async (l: Learning) => {
    try {
      await api.dismissLearning(repo.repoId(), l.id);
      setBump((x) => x + 1);
      showToast({ title: "Learning dismissed", description: "It comes back only if the evidence doubles.", variant: "success" });
    } catch (err) {
      showToast({ title: "Dismiss failed", description: (err as Error).message, variant: "destructive" });
    }
  };
  return (
    <div class="space-y-5">
      <PageHeader
        title="Outcomes"
        description="What humans did after PullUp's decisions, and the settings changes PullUp suggests from it. Nothing here is applied automatically: a suggestion opens as a settings draft you review and save."
      />
      <Show when={!data.error} fallback={<p class="text-sm text-destructive">{(data.error as Error)?.message}</p>}>
        <Show when={d()} fallback={<PageSkeleton />}>
          {(r) => (
            <>
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <Panel label="Decisions">
                  <span class="num text-3xl font-medium" data-testid="outcomes-total">{r().summary.total}</span>
                </Panel>
                <Panel label="Asks not needed">
                  <span class="num text-3xl font-medium text-band-review">{r().summary.askUnneededRate === null ? "—" : pct(r().summary.askUnneededRate!)}</span>
                  <p class="text-xs text-muted-foreground">sent asks approved on the same commit within {r().config.quickApproveMinutes} min</p>
                </Panel>
                <Panel label="Approvals overridden">
                  <span class="num text-3xl font-medium text-band-escalate">{r().summary.approvalsOverridden}</span>
                  <p class="text-xs text-muted-foreground">changes requested, or a revert within {r().config.defectWindowDays} days</p>
                </Panel>
                <Panel label="Change requests addressed">
                  <span class="num text-3xl font-medium text-band-fast">{r().summary.changesAddressed}</span>
                </Panel>
              </div>

              <Panel label="Learnings">
                <Show
                  when={r().learnings.length > 0}
                  fallback={<p class="text-sm text-muted-foreground">No learnings yet. They need several decided pull requests with the same pattern.</p>}
                >
                  <div class="space-y-3" data-testid="learnings">
                    <For each={r().learnings}>
                      {(l) => <LearningCard l={l} onDismiss={() => void dismiss(l)} draftHref={draftHref(l.id)} />}
                    </For>
                  </div>
                </Show>
              </Panel>

              <Panel label="By finding">
                <Show when={r().summary.byFinding.length > 0} fallback={<p class="text-sm text-muted-foreground">No decided outcomes with findings yet.</p>}>
                  <table class="w-full text-sm">
                    <thead class="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th class="py-1.5 font-medium">Finding</th>
                        <th class="py-1.5 font-medium">Pull requests</th>
                        <th class="py-1.5 font-medium">Outcomes</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={r().summary.byFinding}>
                        {(f) => (
                          <tr class="border-t border-border/60">
                            <td class="num py-1.5">{f.findingId}</td>
                            <td class="num py-1.5">{f.pulls}</td>
                            <td class="py-1.5 text-xs">
                              {Object.entries(f.counts)
                                .map(([k, n]) => `${OUTCOME[k as DecisionOutcome["outcome"]].label} ${n}`)
                                .join(" · ")}
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
              </Panel>

              <Panel label="Recent decisions">
                <Show
                  when={r().outcomes.length > 0}
                  fallback={
                    <Empty class="border-0">
                      <EmptyIcon>
                        <Lightbulb />
                      </EmptyIcon>
                      <EmptyTitle>No decisions recorded yet</EmptyTitle>
                      <EmptyDescription>Log or send review actions; outcomes appear as humans review and merge.</EmptyDescription>
                    </Empty>
                  }
                >
                  <ul class="divide-y divide-border/60" data-testid="outcome-list">
                    <For each={r().outcomes.slice(0, 60)}>
                      {(o) => (
                        <li class="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm" data-outcome={o.outcome}>
                          <span>
                            <A href={withMode(`/r/${repo.repoId()}/pulls/${o.pullNumber}`, repo.mode())} class="num text-muted-foreground hover:text-primary">
                              #{o.pullNumber}
                            </A>{" "}
                            {o.action.replaceAll("_", " ")} at <span class="num">{shortSha(o.headSha)}</span>
                            {o.sent ? "" : " · logged only"}
                          </span>
                          <span class="flex items-baseline gap-2">
                            <span class={cn("text-xs font-medium", OUTCOME[o.outcome].cls)}>{OUTCOME[o.outcome].label}</span>
                            <span class="text-xs text-muted-foreground">{o.detail}{o.approximate ? " (approximate)" : ""}</span>
                            <span class="num text-[11px] text-muted-foreground">{dateTime(o.decidedAt)}</span>
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </Panel>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
