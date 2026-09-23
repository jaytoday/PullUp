import { Dynamic } from "solid-js/web";
import { Show } from "solid-js";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { ACTIONS, BANDS, RECOMMENDATIONS, type Band, type BotAction, type Meta, type Recommendation } from "@/lib/meta";

function MetaBadge(props: { meta: Meta; class?: string; compact?: boolean; tip?: boolean }) {
  const badge = () => (
    <Badge variant="outline" class={cn("gap-1.5 whitespace-nowrap font-medium", props.meta.soft, props.class)}>
      <Dynamic component={props.meta.icon} class="size-3" />
      <Show when={!props.compact}>{props.meta.label}</Show>
    </Badge>
  );
  return (
    <Show when={props.tip !== false} fallback={badge()}>
      <Tooltip openDelay={250}>
        <TooltipTrigger as="span" class="inline-flex">
          {badge()}
        </TooltipTrigger>
        <TooltipContent class="max-w-64">{props.meta.hint}</TooltipContent>
      </Tooltip>
    </Show>
  );
}

export const BandBadge = (props: { band: Band; class?: string; compact?: boolean }) => (
  <MetaBadge meta={BANDS[props.band]} class={props.class} compact={props.compact} />
);

export const RecBadge = (props: { rec: Recommendation; class?: string }) => (
  <MetaBadge meta={RECOMMENDATIONS[props.rec]} class={props.class} />
);

export const ActionBadge = (props: { action: BotAction; class?: string; tip?: boolean }) => (
  <MetaBadge meta={ACTIONS[props.action]} class={props.class} tip={props.tip} />
);

/** Tiny coloured dot + label, for inline states. */
export function Dot(props: { class: string; label?: string; pulse?: boolean }) {
  return (
    <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span class="relative flex size-2">
        <Show when={props.pulse}>
          <span class={cn("absolute inline-flex size-full animate-ping rounded-full opacity-50", props.class)} />
        </Show>
        <span class={cn("relative inline-flex size-2 rounded-full", props.class)} />
      </span>
      {props.label}
    </span>
  );
}
