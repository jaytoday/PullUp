import { Show } from "solid-js";
import { Input } from "@/components/ui/input";
import { NumberField, SwitchField } from "../controls";
import { FieldRow, SettingsCard } from "../field-row";
import { useSettings } from "../settings-context";

/** The evidence verifier: a read-only model pass that checks strong findings against the code. */
export function VerifyCard() {
  const s = useSettings();
  const enabled = () => s.get<boolean>("verify.enabled") ?? false;
  return (
    <SettingsCard
      title="Evidence check"
      description="A second, read-only pass on P0/P1 risk-signal findings. It quotes the changed lines that show the problem, and PullUp re-checks every quote against the diff. It can only add friction: with “Verified only” above, a confirmed finding may request changes. It never removes a finding or enables an approval."
      id="verify"
    >
      <SwitchField path="verify.enabled" />
      <Show when={enabled()}>
        <FieldRow path="verify.model">
          <Input
            class="num h-8 w-48"
            value={s.get<string>("verify.model") ?? ""}
            maxLength={64}
            aria-label="Verifier model"
            onChange={(e) => s.set("verify.model", e.currentTarget.value.trim())}
          />
        </FieldRow>
        <NumberField path="verify.maxPerPull" />
        <SwitchField path="verify.inObserve" />
        <NumberField path="verify.budgetUsdPerDay" />
        <p class="py-3 text-xs text-muted-foreground">
          Runs only when asked (“Check evidence” on a pull request, or <span class="num">pullup verify</span>). The live check needs an Anthropic
          API key on the server and reads the repo at the pull request's head through the GitHub App; without a key a deterministic stand-in
          is used. Pull requests that trip the injection check are never sent to the verifier.
        </p>
      </Show>
    </SettingsCard>
  );
}
