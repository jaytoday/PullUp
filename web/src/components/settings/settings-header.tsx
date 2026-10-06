import { For, Show } from "solid-js";
import { Eye, Save, Undo2 } from "lucide-solid";
import { PRESETS } from "@pullup/core/config-schema";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dateTime } from "@/lib/format";
import { safeLatest } from "@/lib/state";
import { ModeControl } from "./mode-control";
import { useSettings } from "./settings-context";

/** Preset + mode, and the sticky unsaved-changes bar. */
export function SettingsHeader() {
  const s = useSettings();
  const server = () => safeLatest(s.server);
  const presetValue = () => (s.preset().id && s.preset().drift === 0 ? s.preset().id! : "custom");
  return (
    <div class="space-y-4 rounded-lg border border-border bg-card px-5 py-4">
      <div class="flex flex-wrap items-center gap-3" data-testid="preset-picker">
        <span class="w-14 text-xs font-medium text-muted-foreground">Preset</span>
        <ToggleGroup
          type="single"
          size="sm"
          value={presetValue()}
          onChange={(v) => v && v !== "custom" && s.applyPreset(v as (typeof PRESETS)[number]["id"])}
          aria-label="Preset"
        >
          <For each={PRESETS}>
            {(p) => (
              <Tooltip openDelay={300}>
                <TooltipTrigger as="span" class="inline-flex">
                  <ToggleGroupItem value={p.id}>{p.label}</ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent class="max-w-64">
                  <div class="font-medium">
                    {p.label} · {p.style}
                  </div>
                  <div class="text-muted-foreground">{p.blurb}</div>
                </TooltipContent>
              </Tooltip>
            )}
          </For>
          <ToggleGroupItem value="custom" disabled={presetValue() !== "custom"}>
            Custom
          </ToggleGroupItem>
        </ToggleGroup>
        <Show when={s.preset().id && s.preset().drift > 0}>
          <span class="text-xs text-muted-foreground" data-testid="preset-drift">
            Based on {PRESETS.find((p) => p.id === s.preset().id)?.label} · {s.preset().drift} change{s.preset().drift === 1 ? "" : "s"}
          </span>
        </Show>
        <span class="ml-auto text-xs text-muted-foreground">Presets set how strict the gate is; the mode sets what PullUp may send.</span>
      </div>
      <ModeControl />
      <Show when={server()}>
        {(srv) => (
          <div class="text-[11px] text-muted-foreground" data-testid="config-version">
            <Show when={srv().version !== null} fallback={<>No saved settings yet — using {srv().path ? "pullup.config.json + " : ""}defaults.</>}>
              Saved v{srv().version}
              <Show when={srv().latest}>{(l) => <> · {dateTime(l().createdAt)}{l().note ? ` · “${l().note}”` : ""}</>}</Show>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

/** Sticky bar under the top bar while there are unsaved changes. */
export function UnsavedBar() {
  const s = useSettings();
  return (
    <Show when={s.dirty()}>
      <div
        class="sticky top-14 z-20 -mx-1 flex flex-wrap items-center gap-3 rounded-lg border border-band-review/40 bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur"
        data-testid="unsaved-bar"
        role="status"
      >
        <span class="text-sm">
          <span class="font-medium">{s.changes().length} unsaved change{s.changes().length === 1 ? "" : "s"}</span>
          <Show when={s.loosened().length > 0}>
            <span class="ml-2 text-band-escalate">· {s.loosened().length} loosen{s.loosened().length === 1 ? "s" : ""} the gate</span>
          </Show>
          <Show when={s.issues().length > 0}>
            <span class="ml-2 text-destructive">· {s.issues().length} field{s.issues().length === 1 ? "" : "s"} to fix</span>
          </Show>
        </span>
        <div class="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => s.discard()}>
            <Undo2 /> Discard
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              s.setPreviewOpen(true);
              void s.runPreview();
            }}
            disabled={s.issues().length > 0}
          >
            <Eye /> Preview
          </Button>
          <Button size="sm" onClick={() => s.setSaveOpen(true)} disabled={s.issues().length > 0}>
            <Save /> Save…
          </Button>
        </div>
      </div>
    </Show>
  );
}
