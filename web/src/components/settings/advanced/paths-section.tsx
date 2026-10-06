import { createMemo, createSignal, For, Show } from "solid-js";
import { APPROVABLE_TIERS, globSchema, resolveConfigFile, tierOfPath, type Tier } from "@pullup/core/config-schema";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/cn";
import { ChipsInput } from "../chips-input";
import { SwitchField } from "../controls";
import { FieldRow } from "../field-row";
import { useSettings } from "../settings-context";

const TIER_HINT: Record<Tier, string> = {
  trivial: "Ship — fast-path eligible",
  low: "Show — approvable",
  standard: "Approvable only if no raised signal",
  high: "Never bot-approved",
  critical: "Always escalates to a human",
};

const TIER_TONE: Record<Tier, string> = {
  trivial: "text-band-fast",
  low: "text-primary",
  standard: "text-band-standard",
  high: "text-band-review",
  critical: "text-band-escalate",
};

export const validateGlob = (g: string) => {
  const r = globSchema.safeParse(g);
  return r.success ? null : (r.error.issues[0]?.message ?? "Invalid glob.");
};

function GlobList(props: { path: string; tone?: "danger" | "success"; label?: string }) {
  const s = useSettings();
  return (
    <FieldRow path={props.path} label={props.label} stacked>
      <ChipsInput
        label={props.path}
        values={s.get<string[]>(props.path) ?? []}
        onChange={(v) => s.set(props.path, v)}
        placeholder="src/api/**"
        validate={validateGlob}
        tone={props.tone}
        max={50}
        mono
      />
    </FieldRow>
  );
}

/** Try a path against the draft's tiers. */
function PathTester() {
  const s = useSettings();
  const [path, setPath] = createSignal("src/api/users.ts");
  const resolved = createMemo(() => resolveConfigFile(s.effective()));
  const tier = () => (path().trim() ? tierOfPath(path().trim(), resolved().policy, resolved().guardrails) : null);
  return (
    <div class="space-y-2 py-3">
      <div class="text-sm font-medium">Test a path</div>
      <div class="flex max-w-xl items-center gap-3">
        <Input value={path()} onInput={(e) => setPath(e.currentTarget.value)} class="num h-8" aria-label="Path to test" />
        <Show when={tier()}>
          {(t) => (
            <span class={cn("num shrink-0 text-sm font-medium", TIER_TONE[t()])} data-testid="tier-result">
              {t()} <span class="font-sans text-xs font-normal text-muted-foreground">· {TIER_HINT[t()]}</span>
            </span>
          )}
        </Show>
      </div>
    </div>
  );
}

export function PathsSection() {
  const s = useSettings();
  return (
    <div class="divide-y divide-border/60">
      <FieldRow path="guardrails.approveMaxTier">
        <ToggleGroup
          type="single"
          size="sm"
          value={s.get<string>("guardrails.approveMaxTier")}
          onChange={(v) => v && s.set("guardrails.approveMaxTier", v)}
          aria-label="Highest approvable tier"
        >
          <For each={APPROVABLE_TIERS}>{(t) => <ToggleGroupItem value={t}>{t}</ToggleGroupItem>}</For>
        </ToggleGroup>
      </FieldRow>
      <PathTester />
      <GlobList path="policy.allowlist.docs" tone="success" />
      <GlobList path="policy.allowlist.test" tone="success" />
      <GlobList path="guardrails.tiers.low" />
      <GlobList path="guardrails.tiers.high" />
      <GlobList path="policy.requireHumanGlobs" tone="danger" />
      <GlobList path="guardrails.sizeExcludeGlobs" />
      <SwitchField path="policy.lockfileWithoutManifest" />
    </div>
  );
}
