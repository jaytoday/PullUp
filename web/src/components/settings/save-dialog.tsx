import { createSignal, Show, createEffect, on } from "solid-js";
import { TriangleAlert } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Callout, CalloutDescription, CalloutTitle } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { showToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/api";
import { safeLatest } from "@/lib/state";
import { ChangeList } from "./change-list";
import { useSettings } from "./settings-context";

/**
 * Review → note → (typed confirm when loosening) → save as a new version.
 * Conflicts (someone saved meanwhile) offer a reload instead of overwriting.
 */
export function SaveDialog() {
  const s = useSettings();
  const [note, setNote] = createSignal("");
  const [confirm, setConfirm] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [conflict, setConflict] = createSignal(false);
  createEffect(on(s.saveOpen, (open) => open && note() === "" && setNote(s.suggestedNote()), { defer: true }));

  const needsConfirm = () => s.loosened().length > 0;
  const questionsChanged = () => s.changes().some((c) => c.path.startsWith("jev.customQuestions") || c.path.startsWith("jev.disabledQuestions"));
  const canSave = () => !saving() && s.issues().length === 0 && (!needsConfirm() || confirm() === s.repoId());

  const close = () => {
    s.setSaveOpen(false);
    setError(null);
    setConflict(false);
    setConfirm("");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.saveConfig(s.repoId(), {
        config: s.draft(),
        note: note().trim(),
        baseVersion: safeLatest(s.server)?.version ?? null,
        ...(needsConfirm() ? { confirmLoosen: confirm() } : {}),
      });
      showToast({ title: `Saved v${res.version.version}`, description: `${res.changes.length} change(s) now apply to every report and action.`, variant: "success" });
      setNote("");
      close();
      s.afterSave();
    } catch (err) {
      if (err instanceof ApiError && err.details.conflict) setConflict(true);
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={s.saveOpen()} onOpenChange={(o) => (o ? s.setSaveOpen(true) : close())}>
      <DialogContent class="max-w-2xl" data-testid="save-dialog">
        <DialogHeader>
          <DialogTitle>Save settings</DialogTitle>
          <DialogDescription>
            Saved as a new version of <span class="num">{s.repoId()}</span>'s settings. Earlier versions stay restorable.
          </DialogDescription>
        </DialogHeader>

        <ChangeList changes={s.changes()} />

        <Show when={questionsChanged()}>
          <Callout variant="warning">
            <CalloutDescription>Changing risk questions resets calibration and re-evaluates open PRs on the next signal run (≈ $0.01).</CalloutDescription>
          </Callout>
        </Show>

        <label class="block space-y-1">
          <span class="text-xs font-medium">Why? (optional, kept in the history)</span>
          <Input value={note()} maxLength={200} onInput={(e) => setNote(e.currentTarget.value)} placeholder="e.g. Start Balanced in evaluation mode" aria-label="Change note" />
        </label>

        <Show when={needsConfirm()}>
          <Callout variant="danger" data-testid="loosen-confirm">
            <CalloutTitle class="flex items-center gap-2">
              <TriangleAlert class="size-4" /> This loosens the gate ({s.loosened().length} change{s.loosened().length === 1 ? "" : "s"})
            </CalloutTitle>
            <CalloutDescription class="space-y-2">
              <p>
                Type <span class="num font-medium">{s.repoId()}</span> to confirm.
              </p>
              <Input value={confirm()} onInput={(e) => setConfirm(e.currentTarget.value)} class="num" aria-label="Type the repo name to confirm" />
            </CalloutDescription>
          </Callout>
        </Show>

        <Show when={error()}>
          <Callout variant="danger" role="alert">
            <CalloutDescription>
              {error()}
              <Show when={conflict()}>
                <div class="mt-2">
                  Your draft is kept.{" "}
                  <Button size="sm" variant="secondary" onClick={() => { close(); s.afterSave(); }}>
                    Load the latest version
                  </Button>
                </div>
              </Show>
            </CalloutDescription>
          </Callout>
        </Show>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!canSave()} data-testid="confirm-save">
            <Show when={saving()}>
              <Spinner size="sm" />
            </Show>
            Save v{(safeLatest(s.server)?.version ?? 0) + 1}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
