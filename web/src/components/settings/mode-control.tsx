import { createSignal, For, Show } from "solid-js";
import { ChevronDown, Lock, TriangleAlert } from "lucide-solid";
import {
  ACTION_LABEL,
  AUTHORITY_ACTIONS,
  AUTHORITY_LEVELS,
  MODE_HINT,
  MODE_LABEL,
  NAMED_MODES,
  approvesWithoutBlocking,
  summarizeAuthority,
  type AuthorityAction,
  type AuthorityLevel,
  type NamedMode,
} from "@pullup/core/config-schema";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem, RadioGroupItemLabel } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Callout, CalloutDescription } from "@/components/ui/callout";
import { SourceBadge } from "./field-row";
import { useSettings } from "./settings-context";

const LEVEL_LABEL: Record<AuthorityLevel, string> = { off: "Off", comment: "Comment", act: "Act" };

const ACT_MEANS: Record<AuthorityAction, string> = {
  approve: "APPROVE review",
  requestChanges: "REQUEST_CHANGES review",
  requestHuman: "request reviewers + comment",
};

/**
 * Mode: named combinations of per-action authority (Off · Evaluation · Block
 * only · Full), with the 3 × 3 grid behind a disclosure for anything custom.
 */
export function ModeControl() {
  const s = useSettings();
  const [open, setOpen] = createSignal(false);
  const showGrid = () => open() || s.mode() === "custom";
  const locked = (a: AuthorityAction, l: AuthorityLevel) => a === "approve" && l === "act" && !s.approvalUnlocked();

  return (
    <div class="space-y-2" data-testid="mode-control">
      <div class="flex flex-wrap items-center gap-3">
        <span class="w-14 text-xs font-medium text-muted-foreground">Mode</span>
        <ToggleGroup
          type="single"
          size="sm"
          value={s.mode()}
          onChange={(v) => v && v !== "custom" && s.setMode(v as NamedMode)}
          aria-label="Action mode"
        >
          <For each={NAMED_MODES}>{(m) => <ToggleGroupItem value={m}>{MODE_LABEL[m]}</ToggleGroupItem>}</For>
          <ToggleGroupItem value="custom" disabled={s.mode() !== "custom"}>
            Custom
          </ToggleGroupItem>
        </ToggleGroup>
        <SourceBadge path="actions" />
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open())} aria-expanded={showGrid()} class="text-xs">
          Per-action control
          <ChevronDown class={showGrid() ? "rotate-180 transition-transform" : "transition-transform"} />
        </Button>
      </div>
      <p class="pl-[68px] text-xs text-muted-foreground" data-testid="mode-hint">
        {MODE_HINT[s.mode()]}
        <Show when={s.mode() === "custom"}> {summarizeAuthority(s.authority())}.</Show>
      </p>

      <Show when={showGrid()}>
        <div class="ml-[68px] max-w-2xl overflow-hidden rounded-md border border-border" data-testid="authority-grid">
          <div class="grid grid-cols-[1.3fr_repeat(3,1fr)] border-b border-border bg-secondary/40 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Decision</span>
            <For each={AUTHORITY_LEVELS}>{(l) => <span>{LEVEL_LABEL[l]}</span>}</For>
          </div>
          <For each={AUTHORITY_ACTIONS}>
            {(a) => (
              <RadioGroup
                orientation="horizontal"
                value={s.authority()[a]}
                onChange={(v: string) => s.setAuthority(a, v as AuthorityLevel)}
                class="grid grid-cols-[1.3fr_repeat(3,1fr)] items-center gap-0 border-b border-border/60 px-3 py-2 last:border-0"
                aria-label={`${ACTION_LABEL[a]} authority`}
                data-action={a}
              >
                <span class="text-sm">
                  {ACTION_LABEL[a]}
                  <span class="block text-[11px] text-muted-foreground">Act = {ACT_MEANS[a]}</span>
                </span>
                <For each={AUTHORITY_LEVELS}>
                  {(l) => (
                    <Show
                      when={locked(a, l)}
                      fallback={
                        <RadioGroupItem value={l} data-level={l}>
                          <RadioGroupItemLabel class="text-xs font-normal">{LEVEL_LABEL[l]}</RadioGroupItemLabel>
                        </RadioGroupItem>
                      }
                    >
                      <Tooltip openDelay={150}>
                        <TooltipTrigger as="div" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="approve-act-locked">
                          <RadioGroupItem value={l} disabled data-level={l}>
                            <RadioGroupItemLabel class="text-xs font-normal text-muted-foreground">{LEVEL_LABEL[l]}</RadioGroupItemLabel>
                          </RadioGroupItem>
                          <Lock class="size-3" />
                        </TooltipTrigger>
                        <TooltipContent class="max-w-72">
                          Approve · Act unlocks once live GitHub delivery is on and this repo's fast-path calibration gate passes.
                          Until then PullUp comments instead.
                          <Show when={s.approvalLockedReason()}>{(r) => <span class="mt-1 block">Now: {r()}.</span>}</Show>
                        </TooltipContent>
                      </Tooltip>
                    </Show>
                  )}
                </For>
              </RadioGroup>
            )}
          </For>
        </div>
      </Show>

      <Show when={approvesWithoutBlocking(s.authority())}>
        <Callout variant="warning" class="ml-[68px] max-w-2xl" data-testid="approve-no-block">
          <CalloutDescription class="flex items-start gap-2">
            <TriangleAlert class="mt-0.5 size-4 shrink-0" />
            PullUp will approve PRs but never block one. Problems it finds will only be commented on.
          </CalloutDescription>
        </Callout>
      </Show>
    </div>
  );
}
