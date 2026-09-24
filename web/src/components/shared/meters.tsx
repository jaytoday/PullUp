import { For, Show } from "solid-js";
import { cn } from "@/lib/cn";
import { hours, prob } from "@/lib/format";

/**
 * Probability as a thin bar with threshold ticks (e.g. review 0.5, escalate
 * 0.85). The fill takes the colour of the highest threshold crossed.
 */
export function ProbBar(props: {
  p: number;
  ticks?: ReadonlyArray<{ at: number; class: string; label: string }>;
  fill?: string;
  class?: string;
}) {
  const crossed = () =>
    [...(props.ticks ?? [])].sort((a, b) => b.at - a.at).find((t) => props.p >= t.at);
  return (
    <div class={cn("flex items-center gap-2.5", props.class)}>
      <div
        class="relative h-1.5 flex-1 rounded-full bg-secondary"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={props.p}
      >
        <div
          class={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-300", crossed()?.class ?? props.fill ?? "bg-band-standard")}
          style={{ width: `${Math.max(1.5, props.p * 100)}%` }}
        />
        <For each={props.ticks ?? []}>
          {(t) => (
            <div
              class="absolute -top-0.5 h-2.5 w-px bg-foreground/35"
              style={{ left: `${t.at * 100}%` }}
              title={`${t.label} ≥ ${t.at}`}
            />
          )}
        </For>
      </div>
      <span class={cn("num w-9 text-right text-xs", crossed() ? "text-foreground" : "text-muted-foreground")}>{prob(props.p)}</span>
    </div>
  );
}

/**
 * Wait so far against the max-wait threshold w*. Fills toward w*; once past
 * it (review no longer pays) the fill turns primary and the overshoot shows.
 */
export function WaitMeter(props: { wait: number; wStar: number; shadowWStar?: number; class?: string }) {
  const scale = () => Math.max(props.wStar, props.shadowWStar ?? 0, props.wait, 1) * 1.1;
  const past = () => props.wait >= props.wStar;
  return (
    <div class={cn("flex min-w-40 items-center gap-2.5", props.class)}>
      <div class="relative h-1.5 flex-1 rounded-full bg-secondary" aria-label={`waited ${hours(props.wait)} of ${hours(props.wStar)}`}>
        <div
          class={cn("absolute inset-y-0 left-0 rounded-full", past() ? "bg-primary" : "bg-band-standard/70")}
          style={{ width: `${(Math.min(props.wait, scale()) / scale()) * 100}%` }}
        />
        <div class="absolute -top-1 h-3.5 w-0.5 rounded-full bg-primary" style={{ left: `${(props.wStar / scale()) * 100}%` }} title={`w* ${hours(props.wStar)}`} />
        <Show when={props.shadowWStar !== undefined && props.shadowWStar !== props.wStar}>
          <div
            class="absolute -top-1 h-3.5 w-0.5 rounded-full bg-band-review/80"
            style={{ left: `${(props.shadowWStar! / scale()) * 100}%` }}
            title={`active-mode w* ${hours(props.shadowWStar!)}`}
          />
        </Show>
      </div>
      <span class="num w-24 text-right text-xs">
        <span class={past() ? "text-primary" : "text-foreground"}>{hours(props.wait)}</span>
        <span class="text-muted-foreground"> / {hours(props.wStar)}</span>
      </span>
    </div>
  );
}
