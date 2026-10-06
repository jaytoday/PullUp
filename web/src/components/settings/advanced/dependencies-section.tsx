import { For } from "solid-js";
import { DEP_UPDATE_KINDS, type DepUpdateKind } from "@pullup/core/config-schema";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldRow } from "../field-row";
import { LimitSlider } from "../limit-slider";
import { useSettings } from "../settings-context";

const KIND_LABEL: Record<DepUpdateKind, string> = {
  "patch:dev": "Patch · dev dependency",
  "minor:dev": "Minor · dev dependency",
  "patch:runtime": "Patch · runtime dependency",
  "minor:runtime": "Minor · runtime dependency",
};

export function DependenciesSection() {
  const s = useSettings();
  const allowed = () => s.get<DepUpdateKind[]>("guardrails.dependencies.autoApprove") ?? [];
  const toggle = (k: DepUpdateKind, on: boolean) =>
    s.set(
      "guardrails.dependencies.autoApprove",
      DEP_UPDATE_KINDS.filter((x) => (x === k ? on : allowed().includes(x))),
    );
  return (
    <div class="divide-y divide-border/60">
      <FieldRow path="guardrails.dependencies.autoApprove" help="Major bumps and new dependencies are never in this list — they follow the “Always require a human” categories." stacked>
        <div class="grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
          <For each={DEP_UPDATE_KINDS}>
            {(k) => (
              <label class="flex items-center gap-2 text-sm">
                <Checkbox checked={allowed().includes(k)} onChange={(v) => toggle(k, v)} aria-label={KIND_LABEL[k]} />
                {KIND_LABEL[k]}
              </label>
            )}
          </For>
        </div>
      </FieldRow>
      <FieldRow
        path="guardrails.dependencies.minReleaseAgeDays"
        aside={<span class="rounded border border-band-review/40 px-1 py-px text-[10px] text-band-review">needs dependency metadata</span>}
        stacked
      >
        <LimitSlider
          label="Minimum release age"
          value={s.get<number | null>("guardrails.dependencies.minReleaseAgeDays")}
          onChange={(v) => s.set("guardrails.dependencies.minReleaseAgeDays", v === null ? null : v)}
          min={0}
          max={30}
          step={1}
          unit="days"
          anchors={[{ at: 14, label: "14 Renovate" }]}
          disabled
        />
        <p class="text-xs text-muted-foreground">Stored but not enforced yet: PullUp doesn't ingest registry publish dates.</p>
      </FieldRow>
    </div>
  );
}
