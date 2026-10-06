import { Show, type JSX } from "solid-js";
import { RotateCcw } from "lucide-solid";
import { fieldFor, getPath } from "@pullup/core/config-schema";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useSettings, type FieldSource } from "./settings-context";

const SOURCE: Record<FieldSource, { label: string; cls: string; hint: string }> = {
  default: { label: "default", cls: "border-border text-muted-foreground/80", hint: "PullUp's built-in default" },
  file: { label: "file", cls: "border-chart-4/40 text-chart-4", hint: "Set in pullup.config.json" },
  repo: { label: "saved", cls: "border-primary/40 text-primary", hint: "Saved in this repo's settings" },
  draft: { label: "edited", cls: "border-band-review/50 bg-band-review/10 text-band-review", hint: "Unsaved change" },
};

/** Where a value comes from: default · file · saved · edited. */
export function SourceBadge(props: { path: string; class?: string }) {
  const s = useSettings();
  const src = () => s.sourceOf(props.path);
  return (
    <span
      class={cn("rounded border px-1 py-px text-[10px] leading-none", SOURCE[src()].cls, props.class)}
      title={SOURCE[src()].hint}
      data-source={src()}
    >
      {SOURCE[src()].label}
    </span>
  );
}

/** Label + help + source + reset + inline error around one control. */
export function FieldRow(props: {
  path: string;
  label?: string;
  help?: JSX.Element;
  children: JSX.Element;
  aside?: JSX.Element;
  class?: string;
  /** Stack the control under the label (sliders, lists) instead of beside it. */
  stacked?: boolean;
  /** The control shows its own validation (e.g. the free-text screen). */
  hideError?: boolean;
}) {
  const s = useSettings();
  const spec = () => fieldFor(props.path);
  const error = () => s.issueFor(props.path);
  // Reset is offered only when the repo layer holds a value for this path.
  const hasRepoValue = () => getPath(s.draft(), props.path) !== undefined;
  return (
    <div class={cn("space-y-2 py-3", props.class)} data-field={props.path}>
      <div class={cn("flex gap-4", props.stacked ? "flex-col" : "items-start justify-between")}>
        <div class="min-w-0 space-y-0.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">{props.label ?? spec()?.label ?? props.path}</span>
            <SourceBadge path={props.path} />
            <Show when={hasRepoValue()}>
              <Tooltip openDelay={300}>
                <TooltipTrigger
                  as="button"
                  type="button"
                  class="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label={`Reset ${props.label ?? props.path}`}
                  onClick={() => s.reset(props.path)}
                >
                  <RotateCcw class="size-3" />
                </TooltipTrigger>
                <TooltipContent>Use the file/default value</TooltipContent>
              </Tooltip>
            </Show>
            {props.aside}
          </div>
          <Show when={props.help ?? spec()?.help}>
            <p class="max-w-prose text-xs text-muted-foreground">{props.help ?? spec()?.help}</p>
          </Show>
        </div>
        <div class={cn(props.stacked ? "w-full" : "shrink-0")}>{props.children}</div>
      </div>
      <Show when={!props.hideError && error()}>
        <p class="text-xs text-destructive" role="alert" data-testid="field-error">
          {error()}
        </p>
      </Show>
    </div>
  );
}

/** Section card used by both tabs. */
export function SettingsCard(props: { title: string; description?: JSX.Element; children: JSX.Element; aside?: JSX.Element; id?: string }) {
  return (
    <section class="rounded-lg border border-border bg-card" id={props.id} aria-label={props.title}>
      <div class="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-3.5">
        <div class="space-y-0.5">
          <h2 class="text-sm font-semibold">{props.title}</h2>
          <Show when={props.description}>
            <p class="text-xs text-muted-foreground">{props.description}</p>
          </Show>
        </div>
        {props.aside}
      </div>
      <div class="divide-y divide-border/60 px-5">{props.children}</div>
    </section>
  );
}
