import { Show } from "solid-js";
import { CHECK_NAME_PATTERN } from "@pullup/core/config-schema";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SwitchField } from "../controls";
import { FieldRow, SettingsCard } from "../field-row";
import { useSettings } from "../settings-context";

/** The GitHub Check run PullUp posts per commit, and whether a change request may fail it. */
export function ChecksCard() {
  const s = useSettings();
  const enabled = () => s.get<boolean>("checks.enabled") ?? false;
  const requestChangesActs = () => s.get<string>("actions.requestChanges") === "act";
  return (
    <SettingsCard
      title="GitHub check"
      description="A “PullUp” check on every commit shows the decision and pins findings to lines. In Evaluation it is always neutral, so it never blocks or unblocks a merge."
      id="checks"
    >
      <SwitchField path="checks.enabled" />
      <Show when={enabled()}>
        <FieldRow path="checks.name">
          <Input
            class="h-8 w-48"
            value={s.get<string>("checks.name") ?? ""}
            maxLength={40}
            aria-label="Check name"
            aria-invalid={!CHECK_NAME_PATTERN.test(s.get<string>("checks.name") ?? "")}
            onChange={(e) => s.set("checks.name", e.currentTarget.value.trim())}
          />
        </FieldRow>
        <FieldRow
          path="checks.blockOn"
          help={
            requestChangesActs()
              ? "Request changes: the check fails when PullUp requests changes, so branch protection can block the merge. Asking a human never fails the check."
              : "Has no effect until Request changes is set to Act in the mode above; until then the check is always neutral."
          }
        >
          <ToggleGroup
            type="single"
            size="sm"
            value={s.get<string>("checks.blockOn")}
            onChange={(v) => v && s.set("checks.blockOn", v)}
            aria-label="Fail the check when"
          >
            <ToggleGroupItem value="never">Never</ToggleGroupItem>
            <ToggleGroupItem value="request-changes">PullUp requests changes</ToggleGroupItem>
          </ToggleGroup>
        </FieldRow>
        <SwitchField path="checks.annotations" />
        <p class="py-3 text-xs text-muted-foreground">
          To make the check required, add <span class="num">{s.get<string>("checks.name")}</span> to the branch protection rule's required
          status checks. GitHub counts a neutral check as passing. The GitHub App needs the Checks read &amp; write permission.
        </p>
      </Show>
    </SettingsCard>
  );
}
