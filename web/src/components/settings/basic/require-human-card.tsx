import { For, Show } from "solid-js";
import { Lock } from "lucide-solid";
import { REQUIRE_HUMAN_CATEGORIES } from "@pullup/core/config-schema";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { SettingsCard, SourceBadge } from "../field-row";
import { useSettings } from "../settings-context";

/** Categories that always escalate to a human (some locked on). */
export function RequireHumanCard() {
  const s = useSettings();
  const path = (id: string) => `guardrails.requireHumanCategories.${id}`;
  return (
    <SettingsCard
      title="Always require a human for…"
      description="A change touching any checked category is escalated to a person, whatever the risk signals say."
      id="require-human"
    >
      <div class="grid grid-cols-1 gap-x-6 py-2 sm:grid-cols-2">
        <For each={REQUIRE_HUMAN_CATEGORIES}>
          {(c) => {
            const checked = () => c.locked || s.get<boolean>(path(c.id));
            return (
              <div class="flex items-start gap-3 py-2.5" data-category={c.id}>
                <Checkbox
                  checked={checked()}
                  disabled={c.locked}
                  onChange={(v) => s.set(path(c.id), v)}
                  aria-label={c.label}
                  class="mt-0.5"
                />
                <div class="min-w-0 space-y-0.5">
                  <div class="flex items-center gap-2">
                    <span class={cn("text-sm", c.locked && "text-muted-foreground")}>{c.label}</span>
                    <Show when={c.locked} fallback={<SourceBadge path={path(c.id)} />}>
                      <Tooltip openDelay={150}>
                        <TooltipTrigger as="span" class="inline-flex text-muted-foreground" aria-label={`${c.label} is always on`}>
                          <Lock class="size-3" />
                        </TooltipTrigger>
                        <TooltipContent class="max-w-64">Always on. {c.help}</TooltipContent>
                      </Tooltip>
                    </Show>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    <Show when={!c.locked}>{c.help} </Show>
                    <Show when={c.globs.length > 0}>
                      <span class="num">{c.globs.slice(0, 3).join(" · ")}{c.globs.length > 3 ? " …" : ""}</span>
                    </Show>
                  </p>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </SettingsCard>
  );
}
