"use client";

import { configSchema, DEFAULT_SEATS, loosenings, NO_ANSWER_OPTIONS, type NoAnswerOption, TRIGGER_IDS, type TriggerId } from "@pullup/engine/config";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BlurFade } from "@/components/effects/blur-fade";
import Stepper, { Step } from "@/components/effects/stepper";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const NO_ANSWER_LABEL: Record<NoAnswerOption, string> = {
  fail: "Fail the run (safest)",
  "follow-council": "Follow the council's lean",
  pass: "Pass the run",
  escalate: "Ask a backup person",
};
const TRIGGER_LABEL: Record<TriggerId, string> = {
  "flaky-test": "Flaky test (failed, then passed on rerun)",
  "weakened-tests": "Weakened tests (skips, deleted tests or assertions, rewritten snapshots)",
  "sensitive-path": "Sensitive paths (sign-in, migrations, payments, secrets, CI configuration)",
};

/**
 * Builds `.pullup/config.json` for one repository. PullUp never writes to the
 * repository: the owner commits the file to the default branch. Settings looser
 * than the defaults are listed and need "loosen" typed before the file is shown.
 */
export function SetupWizard({ appInstallUrl }: { appInstallUrl: string | null }) {
  const [step, setStep] = useState(1);
  const [workflows, setWorkflows] = useState("ci");
  const [to, setTo] = useState("");
  const [toGithub, setToGithub] = useState("");
  const [backup, setBackup] = useState("");
  const [deadline, setDeadline] = useState(240);
  const [onNoAnswer, setOnNoAnswer] = useState<NoAnswerOption>("fail");
  const [after, setAfter] = useState<Exclude<NoAnswerOption, "escalate">>("fail");
  const [triggers, setTriggers] = useState<Record<TriggerId, { enabled: boolean; councilMayPass: boolean }>>({
    "flaky-test": { enabled: true, councilMayPass: true },
    "weakened-tests": { enabled: true, councilMayPass: true },
    "sensitive-path": { enabled: true, councilMayPass: false },
  });
  const [passStrength, setPassStrength] = useState(4);
  const [confirm, setConfirm] = useState("");

  const raw = useMemo(
    () => ({
      requiredWorkflows: workflows.split(",").map((w) => w.trim()).filter(Boolean),
      triggers,
      council: { seats: DEFAULT_SEATS, passStrength, needsPersonBlocksPass: true },
      ask: { to: to.trim(), ...(toGithub.trim() ? { toGithub: toGithub.trim().replace(/^@/, "") } : {}), ...(backup.trim() ? { backup: backup.trim() } : {}), deadlineMinutes: deadline, onNoAnswer, ...(onNoAnswer === "escalate" ? { onNoAnswerAfterBackup: after } : {}) },
    }),
    [workflows, triggers, passStrength, to, toGithub, backup, deadline, onNoAnswer, after],
  );
  const parsed = configSchema.safeParse(raw);
  const loose = parsed.success ? loosenings(parsed.data) : [];
  const confirmed = !loose.length || confirm.trim().toLowerCase() === "loosen";
  // The file holds only what differs from the defaults the engine fills in, plus the required fields.
  const file = JSON.stringify({ requiredWorkflows: raw.requiredWorkflows, ...(JSON.stringify(triggers) === JSON.stringify({ "flaky-test": { enabled: true, councilMayPass: true }, "weakened-tests": { enabled: true, councilMayPass: true }, "sensitive-path": { enabled: true, councilMayPass: false } }) ? {} : { triggers }), ...(passStrength !== 4 ? { council: { passStrength } } : {}), ask: raw.ask }, null, 2);

  const canNext = [true, raw.requiredWorkflows.length > 0, raw.ask.to.length > 0 && (onNoAnswer !== "escalate" || !!backup.trim()), parsed.success && confirmed][step - 1] ?? true;
  const select = "h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground";

  return (
    <Stepper
      step={step}
      onStepChange={setStep}
      onFinalStepCompleted={() => {
        void navigator.clipboard?.writeText(file);
        toast.success("Copied .pullup/config.json");
      }}
      width="100%"
      indicator="numbers"
      transition="fade"
      nextButtonProps={{ disabled: !canNext }}
      completeButtonText="Copy the file"
      completedContent={<p className="text-sm text-body">Copied. Commit it to the default branch as <code className="font-mono">.pullup/config.json</code>; the next finished workflow run shows PullUp&apos;s neutral check.</p>}
      data-testid="setup-wizard"
    >
      <Step title="Install">
        <BlurFade className="space-y-3 text-sm text-body">
          <p>PullUp reads your CI results and posts one check called &quot;PullUp&quot;. It needs the PullUp GitHub App on the repository, with read access to Actions and write access to Checks.</p>
          {appInstallUrl ? (
            <Button href={appInstallUrl} target="_blank" color="neutral" variant="outline" size="sm" trailingIcon="i-lucide-arrow-up-right">
              Install the GitHub App
            </Button>
          ) : (
            <p className="text-muted-foreground">Set GITHUB_APP_SLUG on the server to show the install link here.</p>
          )}
          <p className="text-muted-foreground">Every repository starts in shadow mode: the check is neutral and says what PullUp would decide.</p>
        </BlurFade>
      </Step>
      <Step title="Workflows">
        <BlurFade className="space-y-3">
          <FormField label="Required workflows" description="The names of the GitHub Actions workflows that must finish before PullUp decides, separated by commas. A required workflow that never runs fails the run.">
            <Input value={workflows} onChange={(e) => setWorkflows(e.target.value)} placeholder="ci, e2e" />
          </FormField>
        </BlurFade>
      </Step>
      <Step title="Who to ask">
        <BlurFade className="space-y-3">
          <FormField label="Person to ask" description="An email address, a phone number in international format, or a WithAI member id.">
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="reviewer@example.com" />
          </FormField>
          <FormField label="Their GitHub login (optional)" description="So their Pass / Fail button presses and /pullup comments count as theirs. Repo admins can always answer.">
            <Input value={toGithub} onChange={(e) => setToGithub(e.target.value)} placeholder="octocat" />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Deadline (minutes)">
              <Input type="number" min={1} value={deadline} onChange={(e) => setDeadline(Number(e.target.value) || 1)} />
            </FormField>
            <FormField label="When no one answers">
              <select className={select} value={onNoAnswer} onChange={(e) => setOnNoAnswer(e.target.value as NoAnswerOption)}>
                {NO_ANSWER_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {NO_ANSWER_LABEL[o]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          {onNoAnswer === "escalate" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Backup person">
                <Input value={backup} onChange={(e) => setBackup(e.target.value)} placeholder="oncall@example.com" />
              </FormField>
              <FormField label="If the backup does not answer">
                <select className={select} value={after} onChange={(e) => setAfter(e.target.value as Exclude<NoAnswerOption, "escalate">)}>
                  {NO_ANSWER_OPTIONS.filter((o) => o !== "escalate").map((o) => (
                    <option key={o} value={o}>
                      {NO_ANSWER_LABEL[o]}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          ) : null}
        </BlurFade>
      </Step>
      <Step title="Rules">
        <BlurFade className="space-y-4">
          <ul className="space-y-3">
            {TRIGGER_IDS.map((id) => (
              <li key={id} className="space-y-2 rounded-md bg-background p-3 ring ring-border">
                <p className="text-sm font-medium text-foreground">{TRIGGER_LABEL[id]}</p>
                <label className="flex items-center justify-between gap-3 text-sm text-body">
                  On
                  <Switch checked={triggers[id].enabled} onCheckedChange={(v) => setTriggers({ ...triggers, [id]: { ...triggers[id], enabled: v } })} aria-label={`${id} on`} />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-body">
                  The council may pass it without a person
                  <Switch checked={triggers[id].councilMayPass} onCheckedChange={(v) => setTriggers({ ...triggers, [id]: { ...triggers[id], councilMayPass: v } })} aria-label={`${id} council may pass`} />
                </label>
              </li>
            ))}
          </ul>
          <FormField label="How sure every reviewer must be for a council pass (1 to 5)">
            <Input type="number" min={1} max={5} value={passStrength} onChange={(e) => setPassStrength(Math.min(5, Math.max(1, Number(e.target.value) || 4)))} />
          </FormField>
          {loose.length ? (
            <div className="space-y-2 rounded-md bg-warning/10 p-3 text-sm" data-testid="loosenings">
              <p className="font-medium text-foreground">These settings are looser than PullUp&apos;s defaults:</p>
              <ul className="list-disc space-y-1 ps-5 text-body">
                {loose.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <FormField label='Type "loosen" to keep them'>
                <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
              </FormField>
            </div>
          ) : null}
          {!parsed.success ? <p className="text-sm text-error">{parsed.error.issues[0]?.message}</p> : null}
        </BlurFade>
      </Step>
      <Step title="The file">
        <BlurFade className="space-y-3">
          <p className="text-sm text-body">
            Commit this to the repository&apos;s default branch as <code className="font-mono">.pullup/config.json</code>. PullUp only ever reads it from the default branch, so a pull request cannot loosen its own checks.
          </p>
          <pre className="overflow-x-auto rounded-md bg-elevated p-3 font-mono text-xs text-body" data-testid="config-file">
            {file}
          </pre>
        </BlurFade>
      </Step>
    </Stepper>
  );
}
