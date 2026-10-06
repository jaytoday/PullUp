import { ChipsInput } from "../chips-input";
import { RangeField, SwitchField } from "../controls";
import { FieldRow } from "../field-row";
import { useSettings } from "../settings-context";

const LOGIN = /^[A-Za-z0-9*][A-Za-z0-9*._-]{0,38}(?:\[bot\])?$/;
const validateLogin = (v: string) => (LOGIN.test(v) ? null : "Use a GitHub login (wildcards * allowed).");

export function TestsSection() {
  return (
    <div class="divide-y divide-border/60">
      <SwitchField path="guardrails.tests.requireForBehaviorChange" />
      <SwitchField path="guardrails.tests.testOnlyFastPath" />
    </div>
  );
}

export function AuthorsSection() {
  const s = useSettings();
  return (
    <div class="divide-y divide-border/60">
      <FieldRow path="guardrails.authors.aiAuthors" stacked>
        <ChipsInput
          label="AI authors"
          values={s.get<string[]>("guardrails.authors.aiAuthors") ?? []}
          onChange={(v) => s.set("guardrails.authors.aiAuthors", v)}
          placeholder="copilot*"
          validate={validateLogin}
          max={20}
          mono
        />
      </FieldRow>
      <RangeField path="guardrails.authors.aiSizeMultiplier" format={(v) => `×${v.toFixed(2)}`} />
      <FieldRow path="guardrails.authors.trustedBots" stacked>
        <ChipsInput
          label="trusted bots"
          values={s.get<string[]>("guardrails.authors.trustedBots") ?? []}
          onChange={(v) => s.set("guardrails.authors.trustedBots", v)}
          placeholder="renovate[bot]"
          validate={validateLogin}
          max={20}
          mono
        />
      </FieldRow>
    </div>
  );
}
