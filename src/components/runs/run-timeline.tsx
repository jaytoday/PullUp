import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

export interface TimelineStep {
  label: string;
  detail: string;
  state: "done" | "current" | "skipped" | "todo";
}

/** Collect → triggers → council → person → result, as a vertical timeline. */
export function RunTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="relative space-y-4 ps-7" data-testid="run-timeline">
      <span aria-hidden="true" className="absolute top-1 bottom-1 start-[9px] w-px bg-border" />
      {steps.map((s) => (
        <li key={s.label} className="relative">
          <span
            className={cn(
              "absolute -start-7 top-0.5 flex size-[19px] items-center justify-center rounded-full ring-4 ring-muted",
              s.state === "done" && "bg-primary text-primary-foreground",
              s.state === "current" && "bg-warning text-primary-foreground",
              (s.state === "skipped" || s.state === "todo") && "bg-elevated text-muted-foreground",
            )}
          >
            <Icon name={s.state === "done" ? "i-lucide-check" : s.state === "current" ? "i-lucide-hourglass" : s.state === "skipped" ? "i-lucide-minus" : "i-lucide-circle"} className="size-3" />
          </span>
          <p className={cn("text-sm font-medium", s.state === "skipped" || s.state === "todo" ? "text-muted-foreground" : "text-foreground")}>{s.label}</p>
          <p className="text-sm text-muted-foreground">{s.detail}</p>
        </li>
      ))}
    </ol>
  );
}
