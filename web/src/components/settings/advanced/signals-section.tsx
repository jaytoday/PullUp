import { For, Show } from "solid-js";
import { customQuestionId, type CustomQuestion } from "@pullup/core/config-schema";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { humanize } from "@/lib/format";
import { SIGNALS_LABEL, safeLatest } from "@/lib/state";
import type { JevMode } from "@/lib/api";
import { NumberField, RangeField } from "../controls";
import { FieldRow } from "../field-row";
import { useSettings } from "../settings-context";

const SIGNALS_HINT: Record<JevMode, string> = {
  off: "Jev isn't asked; guardrails and the cost model decide.",
  shadow: "Signals are computed and shown, but don't change decisions.",
  active: "Escalations and the review band take effect; risk can only go up.",
};

export function SignalsSection() {
  const s = useSettings();
  const mode = () => s.get<JevMode>("jev.mode");
  const builtIn = () => safeLatest(s.server)?.questionSet.builtIn ?? [];
  const disabled = () => s.get<string[]>("jev.disabledQuestions") ?? [];
  // Defaults mirror the engine: escalating questions are P0, the rest (and custom ones) P1.
  const levelOf = (q: string, custom: boolean) =>
    s.get<string | undefined>(`severity.questionLevels.${q}`) ??
    (!custom && (safeLatest(s.server)?.questionSet.escalating ?? []).includes(q) ? "p0" : "p1");
  const customIds = () => (s.get<CustomQuestion[]>("jev.customQuestions") ?? []).filter((c) => c.text.trim()).map((c) => customQuestionId(c.text));
  const setAsked = (q: string, asked: boolean) =>
    s.set("jev.disabledQuestions", asked ? disabled().filter((x) => x !== q) : [...disabled(), q]);
  return (
    <div class="divide-y divide-border/60">
      <FieldRow path="jev.mode" label="Risk signals" help={SIGNALS_HINT[mode()]}>
        <ToggleGroup type="single" size="sm" value={mode()} onChange={(v) => v && s.set("jev.mode", v)} aria-label="Risk signals">
          <For each={["off", "shadow", "active"] as JevMode[]}>{(m) => <ToggleGroupItem value={m}>{SIGNALS_LABEL[m]}</ToggleGroupItem>}</For>
        </ToggleGroup>
      </FieldRow>
      <RangeField path="jev.thresholds.sensitiveHigh" />
      <RangeField path="jev.thresholds.sensitiveMedium" />
      <RangeField path="jev.thresholds.injection" />
      <RangeField path="jev.thresholds.fastPathMaxRisk" />
      <RangeField path="jev.thresholds.fastPathMinLowRisk" />
      <RangeField path="jev.thresholds.fastPathMinConfidence" />
      <FieldRow
        path="jev.disabledQuestions"
        label="Risk questions and their levels"
        help="The level a “yes” produces (P0 at high confidence; a P0 question below the escalate threshold counts as P1). Custom questions max out at P1. Unchecking a question stops PullUp asking it — a loosening change that re-versions the question set and resets calibration. The injection tripwire is always asked and always P0."
        stacked
      >
        <div class="divide-y divide-border/50 rounded-md border border-border" data-testid="question-levels">
          <For each={[...builtIn().map((q) => [q, false] as const), ...customIds().map((q) => [q, true] as const)]}>
            {([q, custom]) => (
              <div class="flex flex-wrap items-center justify-between gap-3 px-3 py-1.5" data-question={q}>
                <label class="flex items-center gap-2 text-sm">
                  <Show when={!custom} fallback={<span class="w-4" />}>
                    <Checkbox checked={!disabled().includes(q)} onChange={(v) => setAsked(q, v)} aria-label={`Ask ${humanize(q)}`} />
                  </Show>
                  {custom ? `Custom: ${q.replace(/^custom:/, "").replace(/-/g, " ")}` : humanize(q)}
                </label>
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={levelOf(q, custom)}
                  onChange={(v) => v && s.set(`severity.questionLevels.${q}`, v)}
                  aria-label={`Level for ${q}`}
                >
                  <ToggleGroupItem value="p0" disabled={custom}>P0</ToggleGroupItem>
                  <ToggleGroupItem value="p1">P1</ToggleGroupItem>
                  <ToggleGroupItem value="p2">P2</ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}
          </For>
        </div>
        <Show when={builtIn().length === 0}>
          <p class="text-xs text-muted-foreground">Loading…</p>
        </Show>
      </FieldRow>
      <NumberField path="jev.budgetUsdPerRun" />
      <NumberField path="jev.concurrency" />
      <NumberField path="jev.requestsPerMinute" />
      <NumberField path="jev.multiplierMax" />
    </div>
  );
}
