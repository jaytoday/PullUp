import { Show } from "solid-js";
import { Slider, SliderThumb, SliderTrack } from "@/components/ui/slider";
import { cn } from "@/lib/cn";

/**
 * A slider whose last stop means "no limit" (null). Values snap to `step`.
 */
export function LimitSlider(props: {
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  label: string;
  /** Tick anchors under the track, e.g. [{ at: 100, label: "Google: reasonable" }]. */
  anchors?: ReadonlyArray<{ at: number; label: string }>;
  unlimited?: boolean;
  disabled?: boolean;
  class?: string;
}) {
  const noLimit = () => props.max + props.step;
  const top = () => (props.unlimited === false ? props.max : noLimit());
  const position = () => (props.value === null ? noLimit() : props.value);
  const pct = (v: number) => ((v - props.min) / (top() - props.min)) * 100;
  const text = () => (props.value === null ? "No limit" : `≤ ${props.value} ${props.unit}`);
  return (
    <div class={cn("space-y-1.5", props.class)}>
      <div class="flex items-baseline justify-between">
        <span class="num text-lg font-medium" data-testid="limit-value">
          {text()}
        </span>
        <span class="text-[11px] text-muted-foreground">
          step {props.step} · max {props.max}
        </span>
      </div>
      <Slider
        value={[position()]}
        minValue={props.min}
        maxValue={top()}
        step={props.step}
        disabled={props.disabled}
        getValueLabel={() => text()}
        onChange={(v: number[]) => {
          const x = v[0]!;
          props.onChange(x > props.max ? null : x);
        }}
        aria-label={props.label}
      >
        <SliderTrack>
          <SliderThumb />
        </SliderTrack>
      </Slider>
      <div class="relative h-4 text-[10px] text-muted-foreground">
        <Show when={props.anchors}>
          {props.anchors!.map((a) => (
            <span class="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${pct(a.at)}%` }}>
              {a.label}
            </span>
          ))}
        </Show>
      </div>
    </div>
  );
}
