import { createSignal, For, Show } from "solid-js";
import { X } from "lucide-solid";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * A list of short strings (logins, globs) as removable chips plus an add box.
 * `validate` returns an error message for a candidate, or null.
 */
export function ChipsInput(props: {
  values: readonly string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  label: string;
  validate?: (v: string) => string | null;
  mono?: boolean;
  tone?: "default" | "danger" | "success";
  max?: number;
}) {
  const [text, setText] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const add = () => {
    const v = text().trim();
    if (!v) return;
    if (props.values.includes(v)) {
      setError(`“${v}” is already in the list.`);
      return;
    }
    if (props.max !== undefined && props.values.length >= props.max) {
      setError(`At most ${props.max} entries.`);
      return;
    }
    const e = props.validate?.(v) ?? null;
    if (e) {
      setError(e);
      return;
    }
    props.onChange([...props.values, v]);
    setText("");
    setError(null);
  };
  const tone = () =>
    props.tone === "danger"
      ? "border-band-escalate/30 bg-band-escalate/8 text-band-escalate"
      : props.tone === "success"
        ? "border-band-fast/30 bg-band-fast/8 text-band-fast"
        : "border-border bg-secondary/50 text-foreground";
  return (
    <div class="space-y-2" data-testid={`chips-${props.label}`}>
      <div class="flex flex-wrap gap-1.5">
        <For each={props.values}>
          {(v) => (
            <span class={cn("inline-flex items-center gap-1 rounded border py-0.5 pr-0.5 pl-1.5 text-xs", props.mono && "num", tone())}>
              {v}
              <Button
                variant="ghost"
                size="icon"
                class="size-4 rounded-sm p-0 [&_svg]:size-3"
                aria-label={`Remove ${v}`}
                onClick={() => props.onChange(props.values.filter((x) => x !== v))}
              >
                <X />
              </Button>
            </span>
          )}
        </For>
        <Show when={props.values.length === 0}>
          <span class="text-xs text-muted-foreground">None.</span>
        </Show>
      </div>
      <div class="flex max-w-md gap-2">
        <Input
          value={text()}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={props.placeholder}
          aria-label={`Add to ${props.label}`}
          class={cn("h-8", props.mono && "num")}
        />
        <Button variant="secondary" size="sm" onClick={add} disabled={!text().trim()}>
          Add
        </Button>
      </div>
      <Show when={error()}>
        <p class="text-xs text-destructive" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
}
