import { SettingsCard, FieldRow } from "../field-row";
import { ChipsInput } from "../chips-input";
import { useSettings } from "../settings-context";

const REVIEWER = /^@?[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\/[A-Za-z0-9._-]{1,100})?$/;

export function ReviewersCard() {
  const s = useSettings();
  return (
    <SettingsCard title="Who reviews escalations" description="Requested as reviewers when PullUp asks a human (with “Ask a human” set to Act)." id="reviewers">
      <FieldRow path="jev.humanReviewers" label="Escalation reviewers" stacked>
        <ChipsInput
          label="reviewers"
          values={s.get<string[]>("jev.humanReviewers")}
          onChange={(v) => s.set("jev.humanReviewers", v)}
          placeholder="login or org/team"
          validate={(v) => (REVIEWER.test(v) ? null : "Use a GitHub login or org/team.")}
          max={20}
          mono
        />
      </FieldRow>
    </SettingsCard>
  );
}
