import { For, Show } from "solid-js";
import { Send } from "lucide-solid";
import { ActionBadge } from "@/components/shared/badges";
import { AuthorityPill } from "@/components/shared/authority-pill";
import { DeliveryStatus } from "@/components/shared/delivery-status";
import type { PullDetail } from "@/lib/api";
import { dateTime, shortSha } from "@/lib/format";

/** The exact GitHub call(s) the bot would make under the repo's action mode, and what was recorded or sent. */
export function ActionPreview(props: { detail: PullDetail }) {
  return (
    <div class="space-y-3">
      <Show
        when={props.detail.plannedAction}
        fallback={<p class="text-sm text-muted-foreground">No bot action for this PR (e.g. keep reviewing, or a human already decided).</p>}
      >
        {(a) => (
          <div class="overflow-hidden rounded-md border border-border" data-testid="action-preview">
            <div class="flex items-center justify-between gap-3 border-b border-border bg-secondary/50 px-3 py-2">
              <div class="flex items-center gap-2">
                <ActionBadge action={a().action} />
                <Show when={a().authority}>{(l) => <AuthorityPill level={l()} />}</Show>
                <span class="text-xs text-muted-foreground">via {a().source}</span>
              </div>
              <span class="inline-flex items-center gap-1.5 rounded border border-band-review/35 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-band-review">
                <Send class="size-3" /> NOT SENT
              </span>
            </div>
            <dl class="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3 py-3 text-xs">
              <Show when={a().clamped}>
                <dt class="text-muted-foreground">note</dt>
                <dd class="font-sans text-band-review">{a().clamped}</dd>
              </Show>
              <Show when={a().authority === "off"}>
                <dt class="text-muted-foreground">call</dt>
                <dd class="font-sans text-muted-foreground">none — this action is set to Off, so PullUp stays silent on GitHub.</dd>
              </Show>
              <Show when={a().call.createReview}>
                {(r) => (
                  <>
                    <dt class="text-muted-foreground">call</dt>
                    <dd>pulls.createReview</dd>
                    <dt class="text-muted-foreground">event</dt>
                    <dd class="text-foreground">{r().event}</dd>
                    <dt class="text-muted-foreground">commit_id</dt>
                    <dd>{shortSha(r().commit_id)}</dd>
                    <dt class="text-muted-foreground">body</dt>
                    <dd class="font-sans whitespace-pre-wrap text-foreground/90">{r().body}</dd>
                  </>
                )}
              </Show>
              <Show when={a().call.upsertComment}>
                {(c) => (
                  <>
                    <dt class="text-muted-foreground">call</dt>
                    <dd>issues.createComment / updateComment <span class="text-muted-foreground">(one comment, edited in place)</span></dd>
                    <dt class="text-muted-foreground">body</dt>
                    <dd class="font-sans whitespace-pre-wrap text-foreground/90" data-testid="comment-body">
                      {c().body.replace(c().marker, "").trim()}
                    </dd>
                  </>
                )}
              </Show>
              <Show when={a().call.requestReviewers}>
                {(rr) => (
                  <>
                    <dt class="text-muted-foreground">+ call</dt>
                    <dd>pulls.requestReviewers → {rr().reviewers.join(", ")}</dd>
                  </>
                )}
              </Show>
            </dl>
          </div>
        )}
      </Show>
      <Show when={props.detail.loggedActions.length > 0}>
        <div class="space-y-1.5">
          <div class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recorded for this PR</div>
          <For each={props.detail.loggedActions}>
            {(l) => (
              <div class="flex items-center justify-between gap-3 text-xs">
                <span class="flex items-center gap-2">
                  <ActionBadge action={l.action} tip={false} />
                  <Show when={l.authority}>{(lv) => <AuthorityPill level={lv()} />}</Show>
                  <span class="num text-muted-foreground">{shortSha(l.headSha)}</span>
                  <DeliveryStatus record={l} />
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
