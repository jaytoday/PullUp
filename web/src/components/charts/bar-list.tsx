import { For, Show, type JSX } from "solid-js";
import { cn } from "@/lib/cn";

export interface BarRow {
  readonly label: JSX.Element;
  readonly value: number;
  readonly display?: JSX.Element;
  /** Fill colour class. */
  readonly fill?: string;
  readonly sub?: JSX.Element;
}

/** Labelled horizontal bars, scaled to the max (or `max`). */
export function BarList(props: { rows: readonly BarRow[]; max?: number; class?: string; reference?: { at: number; label: string } }) {
  const max = () => props.max ?? Math.max(1e-9, ...props.rows.map((r) => r.value));
  return (
    <div class={cn("space-y-2.5", props.class)}>
      <For each={props.rows}>
        {(r) => (
          <div class="space-y-1">
            <div class="flex items-baseline justify-between gap-3 text-sm">
              <span class="truncate">{r.label}</span>
              <span class="num text-xs text-muted-foreground">{r.display ?? r.value}</span>
            </div>
            <div class="relative h-1.5 rounded-full bg-secondary">
              <div
                class={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500", r.fill ?? "bg-primary")}
                style={{ width: `${Math.max(1, (r.value / max()) * 100)}%` }}
              />
              <Show when={props.reference}>
                <div
                  class="absolute -top-0.5 h-2.5 w-px bg-foreground/50"
                  style={{ left: `${(props.reference!.at / max()) * 100}%` }}
                  title={props.reference!.label}
                />
              </Show>
            </div>
            <Show when={r.sub}>
              <div class="text-xs text-muted-foreground">{r.sub}</div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

/** One horizontal bar split into coloured segments (e.g. band distribution). */
export function SegmentBar(props: { segments: ReadonlyArray<{ value: number; fill: string; label: string }>; class?: string }) {
  const total = () => props.segments.reduce((s, x) => s + x.value, 0);
  return (
    <div class={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-secondary", props.class)} role="img" aria-label={props.segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
      <For each={props.segments.filter((s) => s.value > 0)}>
        {(s) => <div class={cn("h-full border-r border-background last:border-r-0", s.fill)} style={{ width: `${(s.value / Math.max(1, total())) * 100}%` }} title={`${s.label}: ${s.value}`} />}
      </For>
    </div>
  );
}
