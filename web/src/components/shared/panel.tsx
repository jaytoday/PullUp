import { A } from "@solidjs/router";
import { Show, splitProps, type JSX, type ParentComponent } from "solid-js";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { LinkArrow } from "@/lib/meta";

export interface PanelProps {
  /** Small uppercase label (nikala-style card heading). */
  label: string;
  /** Optional link: renders the corner arrow. */
  href?: string;
  /** Right-aligned header slot (badges, toggles). */
  aside?: JSX.Element;
  class?: string;
  bodyClass?: string;
}

/** Bento panel: tracked uppercase label, optional corner arrow, dense body. */
export const Panel: ParentComponent<PanelProps> = (props) => {
  const [local] = splitProps(props, ["label", "href", "aside", "class", "bodyClass", "children"]);
  return (
    <Card class={cn("flex flex-col overflow-hidden", local.class)}>
      <div class="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
        <h2 class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{local.label}</h2>
        <div class="flex items-center gap-2">
          {local.aside}
          <Show when={local.href}>
            <A
              href={local.href!}
              class="rounded-sm text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={`Open ${local.label}`}
            >
              <LinkArrow class="size-3.5" />
            </A>
          </Show>
        </div>
      </div>
      <div class={cn("flex-1 px-4 pb-4", local.bodyClass)}>{local.children}</div>
    </Card>
  );
};

/** A big mono figure with a caption — the overview's KPI cells. */
export function Figure(props: { value: JSX.Element; unit?: string; caption?: JSX.Element; tone?: string }) {
  return (
    <div class="flex flex-col gap-1">
      <div class={cn("num text-[28px] font-medium leading-none tracking-tight", props.tone)}>
        {props.value}
        <Show when={props.unit}>
          <span class="ml-1 text-sm font-normal text-muted-foreground">{props.unit}</span>
        </Show>
      </div>
      <Show when={props.caption}>
        <div class="text-xs text-muted-foreground">{props.caption}</div>
      </Show>
    </div>
  );
}
