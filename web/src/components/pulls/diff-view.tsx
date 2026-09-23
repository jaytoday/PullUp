import { For } from "solid-js";
import { cn } from "@/lib/cn";

/** Minimal unified-diff renderer: +/- line tinting, header muted. No syntax highlighter (bundle stays small). */
export function DiffView(props: { hunk: string; class?: string }) {
  const lines = () => props.hunk.split("\n");
  return (
    <pre class={cn("num overflow-x-auto rounded-md border border-border bg-background/70 py-2 text-[12px] leading-[1.6]", props.class)}>
      <For each={lines()}>
        {(line) => (
          <div
            class={cn(
              "whitespace-pre px-3",
              line.startsWith("@@")
                ? "text-chart-4/90"
                : line.startsWith("+")
                  ? "bg-band-fast/10 text-band-fast"
                  : line.startsWith("-")
                    ? "bg-band-escalate/10 text-band-escalate"
                    : "text-muted-foreground",
            )}
          >
            {line || " "}
          </div>
        )}
      </For>
    </pre>
  );
}
