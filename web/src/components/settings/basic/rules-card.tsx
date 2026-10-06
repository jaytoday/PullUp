import { createSignal, For, Index, Show } from "solid-js";
import { ArrowDown, ArrowUp, ChevronDown, Info, Plus, Trash2 } from "lucide-solid";
import {
  LEVEL_LABEL,
  LEVEL_OPTIONS,
  RULE_TEMPLATES,
  SEVERITY_LEVELS,
  canLoosen,
  describeRule,
  type ReviewRule,
  type RuleSet,
  type SeverityLevel,
} from "@pullup/core/config-schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/cn";
import { validateGlob } from "../advanced/paths-section";
import { ChipsInput } from "../chips-input";
import { SettingsCard, SourceBadge } from "../field-row";
import { useSettings } from "../settings-context";

const LOGIN = /^[A-Za-z0-9*][A-Za-z0-9*._-]{0,38}(?:\[bot\])?$/;
const REVIEWER = /^@?[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\/[A-Za-z0-9._-]{1,100})?$/;
const ACTION_SHORT = { "request-changes": "Request changes", "ask-human": "Ask a human", note: "Note only" } as const;

function Label(props: { children: string }) {
  return <div class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{props.children}</div>;
}

/** Optional number that falls back to the repo value ("same as repo") when cleared. */
function LimitInput(props: { label: string; value: number | null | undefined; step: number; onChange: (v: number | null | undefined) => void }) {
  return (
    <label class="flex items-center gap-2 text-sm">
      <span class="w-20 text-muted-foreground">{props.label}</span>
      <Input
        type="number"
        class="num h-8 w-24 text-right"
        step={props.step}
        min={0}
        value={props.value === undefined || props.value === null ? "" : String(props.value)}
        placeholder={props.value === null ? "no limit" : "same"}
        aria-label={props.label}
        onChange={(e) => {
          const raw = e.currentTarget.value.trim();
          props.onChange(raw === "" ? undefined : Number(raw));
        }}
      />
      <Button variant="ghost" size="sm" class="text-xs" onClick={() => props.onChange(props.value === null ? undefined : null)}>
        {props.value === null ? "use repo value" : "no limit"}
      </Button>
    </label>
  );
}

function RuleEditor(props: { index: number; rule: ReviewRule; count: number; initiallyOpen: boolean }) {
  const s = useSettings();
  const [open, setOpen] = createSignal(props.initiallyOpen);
  const rules = () => s.get<ReviewRule[]>("rules") ?? [];
  const update = (next: ReviewRule) => s.set("rules", rules().map((r, i) => (i === props.index ? next : r)));
  const setWhen = (patch: Partial<ReviewRule["when"]>) => {
    const when = { ...props.rule.when, ...patch };
    for (const k of Object.keys(when) as (keyof typeof when)[]) {
      const v = when[k];
      if (v === undefined || (Array.isArray(v) && v.length === 0)) delete when[k];
    }
    update({ ...props.rule, when });
  };
  const setSet = (patch: Partial<RuleSet>) => {
    const set: Record<string, unknown> = { ...props.rule.set, ...patch };
    for (const [k, v] of Object.entries(set)) {
      if (v === undefined || v === false || (Array.isArray(v) && v.length === 0)) delete set[k];
      if (k === "severity" && v && Object.keys(v as object).length === 0) delete set[k];
    }
    update({ ...props.rule, set: set as RuleSet });
  };
  const setLevel = (lvl: SeverityLevel, v: string) => {
    const sev: Record<string, string> = { ...(props.rule.set.severity ?? {}) };
    if (v === "same") delete sev[lvl];
    else sev[lvl] = v;
    setSet({ severity: sev as RuleSet["severity"] });
  };
  const move = (dir: -1 | 1) => {
    const rs = [...rules()];
    const j = props.index + dir;
    [rs[props.index], rs[j]] = [rs[j]!, rs[props.index]!];
    s.set("rules", rs);
  };
  const issues = () => s.issues().filter((i) => i.path === `rules.${props.index}` || i.path.startsWith(`rules.${props.index}.`));
  const partial = () => !canLoosen(props.rule);
  const requireTests = () => (props.rule.set.requireTests === undefined ? "same" : props.rule.set.requireTests ? "on" : "off");

  return (
    <div class="rounded-md border border-border bg-background/40" data-testid="rule" data-rule={props.rule.name}>
      <div class="flex items-center gap-2 px-3 py-2">
        <Button variant="ghost" size="icon" class="size-7" aria-label={open() ? "Collapse rule" : "Edit rule"} onClick={() => setOpen(!open())}>
          <ChevronDown class={cn("transition-transform", open() && "rotate-180")} />
        </Button>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{props.rule.name || "Untitled rule"}</div>
          <div class="truncate text-xs text-muted-foreground" data-testid="rule-summary">
            {describeRule(props.rule)}
          </div>
        </div>
        <Show when={props.count >= 0}>
          <span class="num shrink-0 text-[11px] text-muted-foreground" data-testid="rule-count" title="Open PRs this rule applies to, from the last preview">
            {props.count} open PR{props.count === 1 ? "" : "s"}
          </span>
        </Show>
        <Button variant="ghost" size="icon" class="size-7" aria-label="Move rule up" disabled={props.index === 0} onClick={() => move(-1)}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon" class="size-7" aria-label="Move rule down" disabled={props.index === rules().length - 1} onClick={() => move(1)}>
          <ArrowDown />
        </Button>
        <Button variant="ghost" size="icon" class="size-7" aria-label={`Remove rule ${props.rule.name}`} onClick={() => s.set("rules", rules().filter((_, i) => i !== props.index))}>
          <Trash2 />
        </Button>
      </div>
      <Show when={open()}>
        <div class="space-y-4 border-t border-border/60 px-4 py-3">
          <label class="block max-w-sm space-y-1">
            <Label>Name</Label>
            <Input class="h-8" value={props.rule.name} maxLength={60} aria-label="Rule name" onInput={(e) => update({ ...props.rule, name: e.currentTarget.value })} />
          </label>

          <div class="space-y-3">
            <Label>When</Label>
            <div class="space-y-2">
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <span class="text-muted-foreground">Files in</span>
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={props.rule.when.pathMatch ?? "any"}
                  onChange={(v) => v && setWhen({ pathMatch: v === "any" ? undefined : (v as "all") })}
                  aria-label="Path match"
                >
                  <ToggleGroupItem value="any">any changed file</ToggleGroupItem>
                  <ToggleGroupItem value="all">every changed file</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <ChipsInput label={`rule ${props.index} paths`} values={props.rule.when.paths ?? []} onChange={(v) => setWhen({ paths: v })} placeholder="src/billing/**" validate={validateGlob} max={20} mono />
            </div>
            <div class="space-y-1">
              <span class="text-sm text-muted-foreground">and author is</span>
              <ChipsInput
                label={`rule ${props.index} authors`}
                values={props.rule.when.authors ?? []}
                onChange={(v) => setWhen({ authors: v })}
                placeholder="login or pattern (renovate*)"
                validate={(v) => (LOGIN.test(v) ? null : "Use a GitHub login (wildcards * allowed).")}
                max={20}
                mono
              />
            </div>
            <div class="space-y-1">
              <span class="text-sm text-muted-foreground">and has label</span>
              <ChipsInput label={`rule ${props.index} labels`} values={props.rule.when.labels ?? []} onChange={(v) => setWhen({ labels: v })} placeholder="dependencies" max={20} />
            </div>
          </div>

          <div class="space-y-3">
            <Label>Then</Label>
            <div class="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <label class="flex items-center gap-2">
                <Checkbox checked={Boolean(props.rule.set.requireHuman)} onChange={(v) => setSet({ requireHuman: v })} aria-label="Always require a human" />
                Always require a human
              </label>
              <label class="flex items-center gap-2">
                <Checkbox checked={Boolean(props.rule.set.noAutoApprove)} onChange={(v) => setSet({ noAutoApprove: v })} aria-label="Never auto-approve" />
                Never auto-approve
              </label>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span class="w-20 text-muted-foreground">Tests</span>
              <ToggleGroup
                type="single"
                size="sm"
                value={requireTests()}
                onChange={(v) => v && setSet({ requireTests: v === "same" ? undefined : v === "on" })}
                aria-label="Require test changes"
              >
                <ToggleGroupItem value="same">same as repo</ToggleGroupItem>
                <ToggleGroupItem value="on">required</ToggleGroupItem>
                <ToggleGroupItem value="off">not required</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <LimitInput label="Max lines" step={50} value={props.rule.set.maxLines} onChange={(v) => setSet({ maxLines: v })} />
            <LimitInput label="Max files" step={1} value={props.rule.set.maxFiles} onChange={(v) => setSet({ maxFiles: v })} />
            <For each={SEVERITY_LEVELS}>
              {(lvl) => (
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <span class="w-20 text-muted-foreground">{LEVEL_LABEL[lvl]} findings</span>
                  <ToggleGroup
                    type="single"
                    size="sm"
                    value={props.rule.set.severity?.[lvl] ?? "same"}
                    onChange={(v) => v && setLevel(lvl, v)}
                    aria-label={`${LEVEL_LABEL[lvl]} action for this rule`}
                  >
                    <ToggleGroupItem value="same">same as repo</ToggleGroupItem>
                    <For each={LEVEL_OPTIONS[lvl]}>{(a) => <ToggleGroupItem value={a}>{ACTION_SHORT[a]}</ToggleGroupItem>}</For>
                  </ToggleGroup>
                </div>
              )}
            </For>
            <div class="space-y-1">
              <span class="text-sm text-muted-foreground">Also ask</span>
              <ChipsInput
                label={`rule ${props.index} reviewers`}
                values={props.rule.set.reviewers ?? []}
                onChange={(v) => setSet({ reviewers: v })}
                placeholder="login or org/team"
                validate={(v) => (REVIEWER.test(v) ? null : "Use a GitHub login or org/team.")}
                max={10}
                mono
              />
            </div>
          </div>

          <Show when={partial()}>
            <p class="flex items-start gap-2 text-xs text-muted-foreground" data-testid="rule-stricter-note">
              <Info class="mt-0.5 size-3.5 shrink-0" />
              This rule matches when <em>any</em> changed file is in these folders, so it can only make the gate stricter. Choose “every changed
              file” (or scope it by author/label) to let it loosen.
            </p>
          </Show>
          <Show when={issues().length > 0}>
            <ul class="space-y-0.5 text-xs text-destructive" role="alert" data-testid="rule-issues">
              <For each={issues()}>{(i) => <li>{i.message}</li>}</For>
            </ul>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** Optional scoped rules: adjust the repo policy for folders, authors or labels. */
export function RulesCard() {
  const s = useSettings();
  const [menu, setMenu] = createSignal(false);
  const [fresh, setFresh] = createSignal<string | null>(null);
  const rules = () => s.get<ReviewRule[]>("rules") ?? [];
  const counts = () => new Map((s.preview()?.rules ?? []).map((r) => [r.name, r.open]));
  const add = (rule: ReviewRule) => {
    let name = rule.name;
    for (let i = 2; rules().some((r) => r.name.toLowerCase() === name.toLowerCase()); i++) name = `${rule.name} ${i}`;
    setFresh(name);
    s.set("rules", [...rules(), { ...rule, name }]);
    setMenu(false);
  };
  return (
    <SettingsCard
      title="Special cases (optional)"
      description="Different policy for specific folders, authors or labels. A rule that matches only some of a PR's files can only make the gate stricter."
      aside={<SourceBadge path="rules" />}
      id="rules"
    >
      <div class="space-y-2 py-3" data-testid="rules-card">
        <Show when={rules().length === 0}>
          <p class="text-sm text-muted-foreground">No special cases — every PR uses the settings above.</p>
        </Show>
        <Index each={rules()}>{(r, i) => <RuleEditor index={i} rule={r()} count={counts().get(r().name) ?? -1} initiallyOpen={fresh() === r().name} />}</Index>
        <div class="space-y-2 pt-1">
          <Button variant="secondary" size="sm" onClick={() => setMenu(!menu())} disabled={rules().length >= 20} aria-expanded={menu()}>
            <Plus /> Add rule
          </Button>
          <Show when={menu()}>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="rule-templates">
              <For each={RULE_TEMPLATES}>
                {(t) => (
                  <Button variant="outline" class="h-auto flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal" onClick={() => add(t.rule)}>
                    <span class="text-sm font-medium">{t.label}</span>
                    <span class="text-xs font-normal text-muted-foreground">{t.blurb}</span>
                  </Button>
                )}
              </For>
              <Button
                variant="outline"
                class="h-auto flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal"
                onClick={() => add({ name: "New rule", when: { paths: ["src/**"] }, set: { requireHuman: true } })}
              >
                <span class="text-sm font-medium">Blank rule</span>
                <span class="text-xs font-normal text-muted-foreground">Start from scratch.</span>
              </Button>
            </div>
          </Show>
        </div>
      </div>
    </SettingsCard>
  );
}
