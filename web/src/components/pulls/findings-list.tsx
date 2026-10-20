import { For, Show } from "solid-js";
import type { PlannedReviewAction, PullDecision, PullDetail } from "@/lib/api";
import { shortSha } from "@/lib/format";
import { cn } from "@/lib/cn";

type Finding = NonNullable<PullDecision["findings"]>[number];

const LEVEL: Record<Finding["level"], { label: string; cls: string }> = {
  p0: { label: "P0 · blocking", cls: "border-band-escalate/45 bg-band-escalate/10 text-band-escalate" },
  p1: { label: "P1 · important", cls: "border-band-review/45 bg-band-review/10 text-band-review" },
  p2: { label: "P2 · minor", cls: "border-border text-muted-foreground" },
};

type Comments = NonNullable<PullDetail["findingComments"]>;

const STATUS_LABEL: Record<Comments[number]["status"], string> = {
  open: "open",
  "resolved-by-pullup": "resolved by PullUp",
  "resolved-by-human": "resolved by a human",
  deleted: "deleted",
};

/** Per finding: PullUp's inline comments (posted, kept, would post, not posted, would resolve). */
function InlineStatus(props: { findingId: string; inline?: PlannedReviewAction["inline"]; comments: Comments }) {
  const rows = () => props.comments.filter((c) => c.findingId === props.findingId);
  const posting = () => (props.inline?.post ?? []).filter((c) => c.findingId === props.findingId);
  const skipped = () => (props.inline?.notPosted ?? []).filter((c) => c.findingId === props.findingId);
  const resolving = () => new Set((props.inline?.resolve ?? []).map((r) => r.findingKey));
  return (
    <span class="flex w-full flex-wrap gap-x-3 pl-0.5 text-[11px] text-muted-foreground" data-testid="inline-status">
      <For each={rows()}>
        {(c) => (
          <span data-inline-status={c.status}>
            Inline comment on <span class="num">{c.path}</span>: {STATUS_LABEL[c.status]}
            {c.resolvedHeadSha ? ` at ${shortSha(c.resolvedHeadSha)}` : ""}
            {resolving().has(c.findingKey) ? " · would resolve" : ""}
          </span>
        )}
      </For>
      <For each={posting()}>{(c) => <span data-inline-status="would-post">Would comment on <span class="num">{c.path}:{c.line}</span></span>}</For>
      <For each={skipped()}>{(c) => <span data-inline-status="not-posted">Not commented on <span class="num">{c.path}</span>: {c.reason}</span>}</For>
    </span>
  );
}

/** Findings grouped P0 / P1 / P2, with source and whether they count toward the action. */
export function FindingsList(props: { decision: PullDecision; inline?: PlannedReviewAction["inline"]; comments?: Comments }) {
  const findings = () => props.decision.findings ?? [];
  const rules = () => props.decision.scope?.appliedRules ?? [];
  return (
    <div class="space-y-3" data-testid="findings">
      <Show when={rules().length > 0}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs" data-testid="applied-rules">
          <span class="text-muted-foreground">Rules applied:</span>
          <For each={rules()}>
            {(r) => (
              <span class="rounded border border-primary/40 px-1.5 py-0.5 text-primary" title={r.mode === "stricter" ? "Matched some files: stricter only" : "May loosen"}>
                {r.name}
                <span class="ml-1 text-muted-foreground">{r.mode === "stricter" ? "· stricter only" : ""}</span>
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={findings().length > 0} fallback={<p class="text-sm text-muted-foreground">No findings.</p>}>
        <For each={["p0", "p1", "p2"] as const}>
          {(lvl) => (
            <Show when={findings().some((f) => f.level === lvl)}>
              <div class="space-y-1.5">
                <span class={cn("inline-block rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", LEVEL[lvl].cls)}>{LEVEL[lvl].label}</span>
                <ul class="space-y-1">
                  <For each={findings().filter((f) => f.level === lvl)}>
                    {(f) => (
                      <li class={cn("flex flex-wrap items-baseline gap-x-2 text-sm", !f.active && "opacity-60")} data-finding={f.id} data-level={f.level}>
                        <span class="font-medium">{f.title}</span>
                        <span class="num text-xs text-muted-foreground">{f.detail}</span>
                        <span class="text-[11px] text-muted-foreground">
                          {f.source === "rule" ? "rule" : "model signal"}
                          {f.active ? "" : " · observe only"}
                        </span>
                        <Show when={f.source === "signal" && (props.inline || (props.comments ?? []).length > 0)}>
                          <InlineStatus findingId={f.id} inline={props.inline} comments={props.comments ?? []} />
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
          )}
        </For>
      </Show>
    </div>
  );
}
