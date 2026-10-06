import { For, Show } from "solid-js";
import { Eye } from "lucide-solid";
import { fieldsIn, type FieldGroup } from "@pullup/core/config-schema";
import { Button } from "@/components/ui/button";
import { hours } from "@/lib/format";
import { NumberField, RecordFields } from "../controls";
import { useSettings } from "../settings-context";

const GROUPS: ReadonlyArray<[FieldGroup, string]> = [
  ["economics-waiting", "Waiting costs"],
  ["economics-defects", "Defect costs"],
  ["economics-efficacy", "Review efficacy"],
  ["economics-value", "Change value & wait bounds"],
];

export function EconomicsSection() {
  const s = useSettings();
  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-xs" data-testid="economics-wstar">
        <span class="text-muted-foreground">Median w* over open PRs:</span>
        <Show when={s.preview()} fallback={<span class="text-muted-foreground">preview to see how the draft moves it</span>}>
          {(p) => (
            <span class="num">
              {p().maxWait.medianBefore === null ? "—" : hours(p().maxWait.medianBefore!)} →{" "}
              <span class="text-primary">{p().maxWait.medianAfter === null ? "—" : hours(p().maxWait.medianAfter!)}</span>
            </span>
          )}
        </Show>
        <Button variant="ghost" size="sm" class="ml-auto" onClick={() => void s.runPreview()} disabled={s.previewLoading() || s.issues().length > 0}>
          <Eye /> {s.previewLoading() ? "Previewing…" : "Preview"}
        </Button>
      </div>
      <For each={GROUPS}>
        {([group, title]) => (
          <div>
            <div class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</div>
            <div class="divide-y divide-border/60">
              <For each={fieldsIn(group)}>
                {(f) =>
                  f.path.endsWith(".*") ? (
                    <RecordFields path={f.path.slice(0, -2)} title={f.label} />
                  ) : (
                    <NumberField path={f.path} />
                  )
                }
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

export function GatesSection() {
  return (
    <div class="space-y-2">
      <p class="rounded-md border border-band-review/35 bg-band-review/8 px-3 py-2 text-xs text-band-review">
        These gates decide when calibration may move P(defect), and the fast-path gate is the bar for ever un-stubbing approval. Loosening
        any of them needs typed confirmation.
      </p>
      <div class="divide-y divide-border/60">
        <For each={fieldsIn("gates")}>{(f) => <NumberField path={f.path} />}</For>
      </div>
    </div>
  );
}
