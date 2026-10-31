import { Show } from "solid-js";
import { ChipsInput } from "../chips-input";
import { NumberField, SwitchField } from "../controls";
import { FieldRow, SettingsCard } from "../field-row";
import { useSettings } from "../settings-context";

const validateGlob = (v: string) => (/\.(md|mdx)$/i.test(v) ? null : "Walkthroughs are Markdown: end the glob in .md or .mdx.");

/** Walkthrough links: a changed spec file (such as a diffmap spec) linked in the decision comment. */
export function WalkthroughsCard() {
  const s = useSettings();
  const enabled = () => s.get<boolean>("walkthroughs.enabled") ?? true;
  return (
    <SettingsCard
      title="Walkthrough links"
      description="When a pull request changes a walkthrough file, such as a spec written with the diffmap agent skill, PullUp's comment links to it so the reviewer can start there. Information only: the action never changes."
      id="walkthroughs"
    >
      <SwitchField path="walkthroughs.enabled" />
      <Show when={enabled()}>
        <FieldRow path="walkthroughs.paths" stacked>
          <ChipsInput
            label="walkthrough files"
            values={s.get<string[]>("walkthroughs.paths") ?? []}
            onChange={(v) => s.set("walkthroughs.paths", v)}
            placeholder="docs/walkthroughs/**/*.md"
            validate={validateGlob}
            max={20}
            mono
          />
        </FieldRow>
        <NumberField path="walkthroughs.maxLinks" />
        <p class="py-3 text-xs text-muted-foreground">
          Each link is pinned to the commit PullUp decided on. The diffmap viewer reads GitHub without signing in, so it only opens
          specs in public repositories; the GitHub link works for private ones too.
        </p>
      </Show>
    </SettingsCard>
  );
}
