import { For, Show } from "solid-js";
import { Send } from "lucide-solid";
import { ActionBadge } from "@/components/shared/badges";
import type { PullDetail } from "@/lib/api";
import { dateTime, shortSha } from "@/lib/format";

/** The exact GitHub review call the bot would make — logged, never sent. */
export function ActionPreview(props: { detail: PullDetail }) {
  return (
    <div class="space-y-3">
      <Show
        when={props.detail.plannedAction}
        fallback={<p class="text-sm text-muted-foreground">No bot action for this PR (e.g. keep reviewing, or a human already decided).</p>}
      >
        {(a) => (
          <div class="overflow-hidden rounded-md border border-border">
            <div class="flex items-center justify-between gap-3 border-b border-border bg-secondary/50 px-3 py-2">
              <div class="flex items-center gap-2">
                <ActionBadge action={a().action} />
                <span class="text-xs text-muted-foreground">via {a().source}</span>
              </div>
              <span class="inline-flex items-center gap-1.5 rounded border border-band-review/35 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-band-review">
                <Send class="size-3" /> NOT SENT
              </span>
            </div>
            <dl class="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3 py-3 text-xs">
              <dt class="text-muted-foreground">call</dt>
              <dd>pulls.createReview</dd>
              <dt class="text-muted-foreground">event</dt>
              <dd class="text-foreground">{a().call.createReview.event}</dd>
              <dt class="text-muted-foreground">commit_id</dt>
              <dd>{shortSha(a().call.createReview.commit_id)}</dd>
              <Show when={a().call.requestReviewers}>
                {(rr) => (
                  <>
                    <dt class="text-muted-foreground">+ call</dt>
                    <dd>pulls.requestReviewers → {rr().reviewers.join(", ")}</dd>
                  </>
                )}
              </Show>
              <dt class="text-muted-foreground">body</dt>
              <dd class="font-sans whitespace-pre-wrap text-foreground/90">{a().call.createReview.body}</dd>
            </dl>
          </div>
        )}
      </Show>
      <Show when={props.detail.loggedActions.length > 0}>
        <div class="space-y-1.5">
          <div class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Logged for this PR</div>
          <For each={props.detail.loggedActions}>
            {(l) => (
              <div class="flex items-center justify-between gap-3 text-xs">
                <span class="flex items-center gap-2">
                  <ActionBadge action={l.action} tip={false} />
                  <span class="num text-muted-foreground">{shortSha(l.headSha)}</span>
                </span>
                <span class="num text-muted-foreground">{dateTime(l.loggedAt)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
