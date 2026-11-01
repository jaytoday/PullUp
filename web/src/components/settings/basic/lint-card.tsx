import { createResource, For, Show } from "solid-js";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { safeLatest } from "@/lib/state";
import { NumberField } from "../controls";
import { FieldRow, SettingsCard } from "../field-row";
import { useSettings } from "../settings-context";

/** Lint rules: the repo's own rule files (Gallant's format), checked per changed file in their own lane. */
export function LintCard() {
  const s = useSettings();
  const mode = () => s.get<string>("lint.mode") ?? "off";
  const [rules] = createResource(s.repoId, (id) => api.lintRules(id));
  const data = () => safeLatest(rules);
  return (
    <SettingsCard
      title="Lint rules"
      description="Your repo's own rule files, in the format the Gallant linter uses, read from the default branch. Each changed file is checked against the rules whose file pattern matches it. A failing rule is a finding (P2 unless the rule says P1); it never changes the risk score or the calibration, and on its own it can't request changes."
      id="lint"
    >
      <FieldRow path="lint.mode">
        <ToggleGroup type="single" size="sm" value={mode()} onChange={(v) => v && s.set("lint.mode", v)} aria-label="Lint rules">
          <ToggleGroupItem value="off">Off</ToggleGroupItem>
          <ToggleGroupItem value="observe">Observe</ToggleGroupItem>
          <ToggleGroupItem value="on">On</ToggleGroupItem>
        </ToggleGroup>
      </FieldRow>
      <Show when={mode() !== "off"}>
        <FieldRow path="lint.dir">
          <Input
            class="num h-8 w-48"
            value={s.get<string>("lint.dir") ?? ".agents/gallant"}
            maxLength={200}
            aria-label="Rules folder"
            onChange={(e) => s.set("lint.dir", e.currentTarget.value.trim())}
          />
        </FieldRow>
        <FieldRow path="lint.level">
          <ToggleGroup type="single" size="sm" value={s.get<string>("lint.level")} onChange={(v) => v && s.set("lint.level", v)} aria-label="Level of a failing rule">
            <ToggleGroupItem value="p2">P2 · note</ToggleGroupItem>
            <ToggleGroupItem value="p1">P1 · important</ToggleGroupItem>
          </ToggleGroup>
        </FieldRow>
        <NumberField path="lint.budgetUsdPerRun" />
      </Show>
      <div class="py-3 text-xs text-muted-foreground" data-testid="lint-rules">
        <Show
          when={data()?.source}
          fallback={<p>No rules read yet. They are read from the default branch when the repo is ingested with lint on, or with <span class="num">pullup lint-rules &lt;repo&gt; --from-ref origin/main</span>.</p>}
        >
          {(src) => (
            <>
              <p>
                {data()!.rules.length} rule{data()!.rules.length === 1 ? "" : "s"} from <span class="num">{src().dir}</span>
                {src().ref ? <> on <span class="num">{src().ref}</span></> : null}
                {src().commitSha ? <> at <span class="num">{src().commitSha!.slice(0, 7)}</span></> : null}.
              </p>
              <ul class="mt-1 space-y-0.5">
                <For each={data()!.rules}>
                  {(r) => (
                    <li class="num">
                      {r.path} · {r.type} · {r.appliesTo.join(" ")} · {r.level.toUpperCase()}
                    </li>
                  )}
                </For>
                <For each={data()!.problems}>
                  {(p) => (
                    <li class="text-band-review">
                      <span class="num">{p.path}</span> not used: {p.message}
                    </li>
                  )}
                </For>
              </ul>
            </>
          )}
        </Show>
        <p class="mt-2">
          Developers can run the same rules before pushing with <span class="num">pullup lint</span>, or with Gallant itself. P2 findings show in
          PullUp's comment; for comments on the lines, set “Comments on the lines” to All.
        </p>
      </div>
    </SettingsCard>
  );
}
