import { For, Show } from "solid-js";
import { Plus, Trash2 } from "lucide-solid";
import type { FreezeWindow } from "@pullup/core/config-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldRow } from "../field-row";
import { useSettings } from "../settings-context";

const day = (iso: string) => iso.slice(0, 10);
const toIso = (d: string) => (d ? `${d}T00:00:00.000Z` : "");

export function FreezeSection() {
  const s = useSettings();
  const windows = () => s.get<FreezeWindow[]>("guardrails.freezeWindows") ?? [];
  const update = (i: number, patch: Partial<FreezeWindow>) =>
    s.set(
      "guardrails.freezeWindows",
      windows().map((w, j) => (j === i ? { ...w, ...patch } : w)),
    );
  const add = () => {
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 86_400_000);
    s.set("guardrails.freezeWindows", [...windows(), { start: toIso(day(start.toISOString())), end: toIso(day(end.toISOString())), note: "" }]);
  };
  return (
    <FieldRow path="guardrails.freezeWindows" stacked>
      <div class="space-y-2">
        <For each={windows()}>
          {(w, i) => (
            <div class="flex flex-wrap items-center gap-2" data-testid="freeze-window">
              <Input type="date" class="num h-8 w-40" value={day(w.start)} aria-label="Freeze start" onChange={(e) => update(i(), { start: toIso(e.currentTarget.value) })} />
              <span class="text-xs text-muted-foreground">to</span>
              <Input type="date" class="num h-8 w-40" value={day(w.end)} aria-label="Freeze end" onChange={(e) => update(i(), { end: toIso(e.currentTarget.value) })} />
              <Input
                class="h-8 max-w-56"
                value={w.note ?? ""}
                maxLength={80}
                placeholder="Note (e.g. launch week)"
                aria-label="Freeze note"
                onChange={(e) => update(i(), { note: e.currentTarget.value })}
              />
              <Button variant="ghost" size="icon" class="size-8" aria-label="Remove freeze window" onClick={() => s.set("guardrails.freezeWindows", windows().filter((_, j) => j !== i()))}>
                <Trash2 />
              </Button>
            </div>
          )}
        </For>
        <Show when={windows().length === 0}>
          <p class="text-xs text-muted-foreground">No freeze windows.</p>
        </Show>
        <Button variant="secondary" size="sm" onClick={add}>
          <Plus /> Add freeze window
        </Button>
      </div>
    </FieldRow>
  );
}
