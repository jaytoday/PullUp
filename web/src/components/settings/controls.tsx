// Small registry-driven controls shared by the Advanced sections.

import { For, Show } from "solid-js";
import { fieldFor, type FieldSpec } from "@pullup/core/config-schema";
import { Input } from "@/components/ui/input";
import { Slider, SliderThumb, SliderTrack } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { FieldRow } from "./field-row";
import { useSettings } from "./settings-context";

function spec(path: string): FieldSpec {
  const f = fieldFor(path);
  if (!f) throw new Error(`No field spec for ${path}`);
  return f;
}

/** A number input bound to a config path; empty input resets to the file/default. */
export function NumberField(props: { path: string; label?: string; help?: string | null }) {
  const s = useSettings();
  const f = () => spec(props.path);
  return (
    <FieldRow path={props.path} label={props.label} help={props.help === null ? undefined : props.help}>
      <div class="flex items-center gap-2">
        <Input
          type="number"
          class="num h-8 w-28 text-right"
          value={String(s.get<number>(props.path) ?? "")}
          min={f().min}
          max={f().max}
          step={f().step ?? "any"}
          aria-label={props.label ?? f().label}
          onChange={(e) => {
            const raw = e.currentTarget.value.trim();
            if (raw === "") s.reset(props.path);
            else s.set(props.path, Number(raw));
          }}
        />
        <Show when={f().unit}>
          <span class="w-16 text-xs text-muted-foreground">{f().unit}</span>
        </Show>
      </div>
    </FieldRow>
  );
}

/** A 0..1-style slider bound to a config path, with the value shown. */
export function RangeField(props: { path: string; format?: (v: number) => string }) {
  const s = useSettings();
  const f = () => spec(props.path);
  const v = () => s.get<number>(props.path);
  const fmt = (x: number) => (props.format ? props.format(x) : x.toFixed(2));
  return (
    <FieldRow path={props.path} stacked>
      <div class="flex items-center gap-4">
        <Slider
          class="max-w-md"
          value={[v()]}
          minValue={f().min ?? 0}
          maxValue={f().max ?? 1}
          step={f().step ?? 0.05}
          getValueLabel={() => fmt(v())}
          onChange={(x: number[]) => s.set(props.path, Math.round(x[0]! * 1000) / 1000)}
          aria-label={f().label}
        >
          <SliderTrack>
            <SliderThumb />
          </SliderTrack>
        </Slider>
        <span class="num w-14 text-right text-sm" data-testid={`value-${props.path}`}>
          {fmt(v())}
        </span>
      </div>
    </FieldRow>
  );
}

/** A switch bound to a boolean config path. */
export function SwitchField(props: { path: string; label?: string; help?: string }) {
  const s = useSettings();
  return (
    <FieldRow path={props.path} label={props.label} help={props.help}>
      <Switch
        checked={s.get<boolean>(props.path)}
        onChange={(v) => s.set(props.path, v)}
        aria-label={props.label ?? spec(props.path).label}
      />
    </FieldRow>
  );
}

/** Number inputs for every key of a record field (e.g. defect rate per change type). */
export function RecordFields(props: { path: string; title: string }) {
  const s = useSettings();
  const keys = () => Object.keys(s.get<Record<string, number>>(props.path) ?? {});
  return (
    <div class="py-3">
      <div class="mb-1 text-sm font-medium">{props.title}</div>
      <p class="mb-2 text-xs text-muted-foreground">{fieldFor(`${props.path}.x`)?.help}</p>
      <div class="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
        <For each={keys()}>{(k) => <NumberField path={`${props.path}.${k}`} label={k} help={null} />}</For>
      </div>
    </div>
  );
}
