import { Show } from "solid-js";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NumberField, SwitchField } from "../controls";
import { FieldRow, SettingsCard } from "../field-row";
import { useSettings } from "../settings-context";

/** Inline finding comments: located findings on the diff lines, resolved when a push fixes them. */
export function InlineCard() {
  const s = useSettings();
  const enabled = () => s.get<boolean>("inline.enabled") ?? false;
  return (
    <SettingsCard
      title="Comments on the lines"
      description="Post located risk-signal findings as inline review comments, and resolve PullUp's own comment when a later push makes the finding go away. Information only: the action never changes."
      id="inline"
    >
      <SwitchField path="inline.enabled" />
      <Show when={enabled()}>
        <FieldRow path="inline.reportOn">
          <ToggleGroup type="single" size="sm" value={s.get<string>("inline.reportOn")} onChange={(v) => v && s.set("inline.reportOn", v)} aria-label="Comment on findings at">
            <ToggleGroupItem value="p0">P0 only</ToggleGroupItem>
            <ToggleGroupItem value="p1">P0–P1</ToggleGroupItem>
            <ToggleGroupItem value="p2">All</ToggleGroupItem>
          </ToggleGroup>
        </FieldRow>
        <SwitchField path="inline.includeObserve" />
        <NumberField path="inline.maxComments" />
        <SwitchField path="inline.resolveFixed" />
        <NumberField path="inline.maxResolutions" />
        <p class="py-3 text-xs text-muted-foreground">
          Not posted on pull requests that trip the injection check, or for repos in the Observe profile. If branch protection requires
          conversations to be resolved, PullUp's open threads count; PullUp only ever resolves threads it wrote itself.
        </p>
      </Show>
    </SettingsCard>
  );
}
