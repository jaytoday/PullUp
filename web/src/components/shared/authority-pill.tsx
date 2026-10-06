import type { AuthorityLevel } from "@pullup/core/config-schema";
import { cn } from "@/lib/cn";

const STYLE: Record<AuthorityLevel, { label: string; cls: string; hint: string }> = {
  act: { label: "Act", cls: "border-primary/40 text-primary", hint: "The real review action" },
  comment: { label: "Comment only", cls: "border-band-review/40 text-band-review", hint: "One PullUp comment saying what it would do" },
  off: { label: "Silent", cls: "border-border text-muted-foreground", hint: "Nothing on GitHub" },
};

/** How much of a planned action PullUp may send (act / comment / off). */
export function AuthorityPill(props: { level: AuthorityLevel; class?: string }) {
  return (
    <span
      class={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STYLE[props.level].cls, props.class)}
      title={STYLE[props.level].hint}
      data-authority={props.level}
    >
      {STYLE[props.level].label}
    </span>
  );
}
