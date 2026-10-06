import { createResource, Show } from "solid-js";
import { FILES_MAX, SIZE_MAX, SIZE_STEP } from "@pullup/core/config-schema";
import { api } from "@/lib/api";
import { pct } from "@/lib/format";
import { safeLatest } from "@/lib/state";
import { FieldRow, SettingsCard } from "../field-row";
import { LimitSlider } from "../limit-slider";
import { useSettings } from "../settings-context";
import { coverage, percentile, SizeHistogram } from "./size-histogram";

/** Industry anchors under the size slider (Google eng-practices). */
const SIZE_ANCHORS = [
  { at: 100, label: "100 reasonable" },
  { at: 1000, label: "1000 too large" },
];

/** Guardrails: how big a change PullUp may approve on its own. */
export function LimitsCard() {
  const s = useSettings();
  const [stats] = createResource(s.repoId, (id) => api.sizeStats(id));
  const lines = () => s.get<number | null>("guardrails.maxAutoApproveLines");
  const files = () => s.get<number | null>("guardrails.maxAutoApproveFiles");
  const lineValues = () => safeLatest(stats)?.lines ?? [];
  const fileValues = () => safeLatest(stats)?.files ?? [];
  const readout = (values: readonly number[], limit: number | null, unit: string) => {
    const c = coverage(values, limit);
    if (c === null) return "No merged history to compare against yet.";
    const p50 = percentile(values, 0.5);
    return `Covers ${pct(c)} of your last ${values.length} merged PRs (median ${p50} ${unit}).`;
  };
  return (
    <SettingsCard
      title="Auto-approval limits"
      description="PullUp only approves changes inside these limits. Bigger changes wait for a human once review stops paying."
      id="limits"
    >
      <FieldRow path="guardrails.maxAutoApproveLines" stacked>
        <div class="space-y-2">
          <SizeHistogram values={lineValues()} step={SIZE_STEP} max={SIZE_MAX} limit={lines()} />
          <LimitSlider
            label="Max lines changed"
            value={lines()}
            onChange={(v) => s.set("guardrails.maxAutoApproveLines", v)}
            min={0}
            max={SIZE_MAX}
            step={SIZE_STEP}
            unit="lines"
            anchors={SIZE_ANCHORS}
          />
          <p class="text-xs text-muted-foreground" data-testid="lines-coverage">
            {readout(lineValues(), lines(), "lines")}
          </p>
        </div>
      </FieldRow>
      <FieldRow path="guardrails.maxAutoApproveFiles" stacked>
        <div class="space-y-2">
          <LimitSlider
            label="Max files changed"
            value={files()}
            onChange={(v) => s.set("guardrails.maxAutoApproveFiles", v)}
            min={1}
            max={FILES_MAX}
            step={1}
            unit="files"
          />
          <p class="text-xs text-muted-foreground">{readout(fileValues(), files(), "files")}</p>
        </div>
      </FieldRow>
      <Show when={s.get<number>("guardrails.authors.aiSizeMultiplier") < 1}>
        <p class="py-3 text-xs text-muted-foreground">
          AI-authored PRs get ×{s.get<number>("guardrails.authors.aiSizeMultiplier")} of these limits (Advanced → Authors).
        </p>
      </Show>
    </SettingsCard>
  );
}
