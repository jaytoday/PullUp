import { createMemo, For } from "solid-js";
import { cn } from "@/lib/cn";

/**
 * A strip of this repo's merged-PR sizes, bucketed like the slider, with the
 * buckets at or under the current limit highlighted.
 */
export function SizeHistogram(props: { values: readonly number[]; step: number; max: number; limit: number | null }) {
  const buckets = createMemo(() => {
    const n = Math.floor(props.max / props.step) + 2; // …, max, and "over max"
    const counts = Array.from({ length: n }, () => 0);
    for (const v of props.values) counts[Math.min(n - 1, Math.ceil(v / props.step))]! += 1;
    return counts;
  });
  const peak = () => Math.max(1, ...buckets());
  const covered = (i: number) => props.limit === null || i * props.step <= props.limit;
  return (
    <div class="flex h-10 items-end gap-px" aria-hidden="true" data-testid="size-histogram">
      <For each={buckets()}>
        {(c, i) => (
          <div
            class={cn("flex-1 rounded-t-sm", covered(i()) ? "bg-primary/55" : "bg-muted-foreground/25")}
            style={{ height: `${Math.max(c > 0 ? 6 : 2, (c / peak()) * 100)}%` }}
            title={`${i() === buckets().length - 1 ? `> ${props.max}` : `≤ ${i() * props.step}`}: ${c} PRs`}
          />
        )}
      </For>
    </div>
  );
}

/** Share of values at or under the limit (null = no limit → all). */
export function coverage(values: readonly number[], limit: number | null): number | null {
  if (values.length === 0) return null;
  if (limit === null) return 1;
  return values.filter((v) => v <= limit).length / values.length;
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}
