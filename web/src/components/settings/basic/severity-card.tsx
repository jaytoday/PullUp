import { For } from "solid-js";
import {
  ACTION_LABEL_SEVERITY,
  LEVEL_LABEL,
  LEVEL_MEANING,
  LEVEL_OPTIONS,
  SEVERITY_LEVELS,
  type SeverityAction,
} from "@pullup/core/config-schema";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FieldRow, SettingsCard } from "../field-row";
import { useSettings } from "../settings-context";

const TONE: Record<string, string> = { p0: "text-band-escalate", p1: "text-band-review", p2: "text-muted-foreground" };

/** What PullUp does about P0 / P1 / P2 findings — one row per level. */
export function SeverityCard() {
  const s = useSettings();
  return (
    <SettingsCard
      title="When PullUp finds problems"
      description="Every finding gets a level. Choose what PullUp does for each; the mode above still decides whether it's sent or only commented."
      id="severity"
    >
      <For each={SEVERITY_LEVELS}>
        {(lvl) => (
          <FieldRow
            path={`severity.actions.${lvl}`}
            label={`${LEVEL_LABEL[lvl]} findings`}
            help={LEVEL_MEANING[lvl]}
            aside={<span class={`num text-[11px] font-semibold ${TONE[lvl]}`}>{LEVEL_LABEL[lvl]}</span>}
          >
            <ToggleGroup
              type="single"
              size="sm"
              value={s.get<string>(`severity.actions.${lvl}`)}
              onChange={(v) => v && s.set(`severity.actions.${lvl}`, v)}
              aria-label={`${LEVEL_LABEL[lvl]} action`}
              data-level={lvl}
            >
              <For each={LEVEL_OPTIONS[lvl]}>
                {(a: SeverityAction) => <ToggleGroupItem value={a}>{a === "note" ? "Note only" : ACTION_LABEL_SEVERITY[a]}</ToggleGroupItem>}
              </For>
            </ToggleGroup>
          </FieldRow>
        )}
      </For>
      <FieldRow
        path="severity.signalsCanRequestChanges"
        help="Off (recommended): only rule-confirmed findings request changes; findings from model signals ask a human instead, so a false positive never blocks an author. Verified: a model finding may request changes only when the evidence check confirmed it with quotes from the diff (needs “Check strong findings against the code”). The injection tripwire always asks a human."
      >
        <ToggleGroup
          type="single"
          size="sm"
          value={String(s.get<boolean | "verified">("severity.signalsCanRequestChanges"))}
          onChange={(v) => v && s.set("severity.signalsCanRequestChanges", v === "verified" ? "verified" : v === "true")}
          aria-label="Let model signals request changes"
        >
          <ToggleGroupItem value="false">Off</ToggleGroupItem>
          <ToggleGroupItem value="verified">Verified only</ToggleGroupItem>
          <ToggleGroupItem value="true">Always</ToggleGroupItem>
        </ToggleGroup>
      </FieldRow>
    </SettingsCard>
  );
}
