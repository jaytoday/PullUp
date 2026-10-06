import { For, Show } from "solid-js";
import type { ConfigChange } from "@pullup/core/config-schema";
import { cn } from "@/lib/cn";

const DIRECTION: Record<ConfigChange["direction"], { label: string; cls: string }> = {
  loosens: { label: "loosens", cls: "border-band-escalate/45 bg-band-escalate/10 text-band-escalate" },
  tightens: { label: "tightens", cls: "border-band-fast/45 bg-band-fast/10 text-band-fast" },
  neutral: { label: "change", cls: "border-border text-muted-foreground" },
};

function show(v: unknown): string {
  if (v === null) return "no limit / none";
  if (v === undefined) return "—";
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t.length > 60 ? `${t.slice(0, 57)}…` : t === "" ? "(empty)" : t;
}

/** Field-level changes with loosens / tightens labels. */
export function ChangeList(props: { changes: readonly ConfigChange[] }) {
  return (
    <Show when={props.changes.length > 0} fallback={<p class="text-xs text-muted-foreground">No field changes.</p>}>
      <ul class="divide-y divide-border/60 rounded-md border border-border" data-testid="change-list">
        <For each={props.changes}>
          {(c) => (
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs" data-direction={c.direction} data-path={c.path}>
              <span class={cn("rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", DIRECTION[c.direction].cls)}>
                {DIRECTION[c.direction].label}
              </span>
              <span class="font-medium">{c.label}</span>
              <span class="num text-muted-foreground">
                {show(c.before)} → <span class="text-foreground">{show(c.after)}</span>
              </span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
