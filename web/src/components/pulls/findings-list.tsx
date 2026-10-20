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

const VERDICT: Record<string, { label: string; cls: string; hint: string }> = {
  confirmed: { label: "Confirmed", cls: "border-band-escalate/45 text-band-escalate", hint: "The evidence check found changed lines that do what the question asks." },
  "not-confirmed": { label: "Not confirmed", cls: "border-border text-muted-foreground", hint: "The evidence check didn't confirm this. It still asks a human; it never lowers the level." },
  unsure: { label: "Unsure", cls: "border-band-review/45 text-band-review", hint: "The evidence check couldn't tell, or its answer failed PullUp's checks." },
};

/** The evidence verifier's verdict on one finding: a chip, the quoted lines and the suggested fix. */
function VerdictView(props: { verdict: NonNullable<Finding["verdict"]> }) {
  const v = () => (props.verdict.accepted || props.verdict.verdict !== "confirmed" ? props.verdict.verdict : "unsure");
  return (
    <span class="flex w-full flex-col gap-1 pl-0.5 text-[11px]" data-testid="verdict" data-verdict={v()}>
      <span class="flex flex-wrap items-center gap-2">
        <span class={cn("rounded border px-1 py-px font-semibold", VERDICT[v()]!.cls)} title={VERDICT[v()]!.hint}>
          {VERDICT[v()]!.label}
        </span>
        <span class="text-muted-foreground">{props.verdict.reason}</span>
      </span>
      <For each={props.verdict.accepted ? props.verdict.evidence : []}>
        {(e) => (
          <code class="num block truncate rounded bg-muted/40 px-1.5 py-0.5 text-[11px]">
            {e.path}:{e.line} {e.quote}
          </code>
        )}
      </For>
      <Show when={props.verdict.fix}>
        <span class="text-muted-foreground">Suggested fix: {props.verdict.fix}</span>
      </Show>
    </span>
  );
}

/** Findings grouped P0 / P1 / P2, with source and whether they count toward the action. */
export function FindingsList(props: { decision: PullDecision; inline?: PlannedReviewAction["inline"]; comments?: Comments }) {
  const findings = () => props.decision.findings ?? [];
  const rules = () => props.decision.scope?.appliedRules ?? [];
  // PullUp's inline comments whose finding is gone (fixed or the file left the PR) still deserve a line.
  const earlier = () => (props.comments ?? []).filter((c) => !findings().some((f) => f.id === c.findingId));
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
      <Show when={earlier().length > 0}>
        <div class="space-y-1" data-testid="earlier-comments">
          <span class="text-[11px] font-medium text-muted-foreground">Earlier PullUp comments (finding no longer present)</span>
          <ul class="space-y-0.5 text-xs text-muted-foreground">
            <For each={earlier()}>
              {(c) => (
                <li data-inline-status={c.status}>
                  <span class="num">{c.findingId}</span> on <span class="num">{c.path}</span>: {STATUS_LABEL[c.status]}
                  {c.resolvedHeadSha ? ` at ${shortSha(c.resolvedHeadSha)}` : ""}
                  {(props.inline?.resolve ?? []).some((r) => r.findingKey === c.findingKey) ? " · would resolve" : ""}
                </li>
              )}
            </For>
          </ul>
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
                        <Show when={f.verdict}>{(v) => <VerdictView verdict={v()} />}</Show>
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
