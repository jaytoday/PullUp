import { createSignal, Show } from "solid-js";
import { OctagonX } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Callout, CalloutDescription } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { showToast } from "@/components/ui/toast";
import { api } from "@/lib/api";

/**
 * "Stop PullUp": turns the stop switch on, globally or for one repo. Every new
 * GitHub write is then denied and outstanding permits are refused at send
 * time. Stopping only removes authority, so it is safe from the dashboard;
 * resuming is CLI-only (`pnpm pullup resume`), because this API has no login.
 */
export function StopDialog(props: { scope?: string; disabled?: boolean; onStopped?: () => void }) {
  const [open, setOpen] = createSignal(false);
  const [reason, setReason] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const where = () => (props.scope ? props.scope : "every repository");

  const stop = async () => {
    setBusy(true);
    try {
      await api.stop({ ...(props.scope ? { scope: props.scope } : {}), reason: reason().trim() });
      showToast({ title: "PullUp stopped", description: `No GitHub writes on ${where()} until an operator resumes it from the CLI.`, variant: "success" });
      setOpen(false);
      setReason("");
      props.onStopped?.();
    } catch (err) {
      showToast({ title: "Couldn't stop PullUp", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)} disabled={props.disabled} data-testid="stop-pullup">
        <OctagonX class="size-4" />
        {props.scope ? "Stop on this repo" : "Stop PullUp"}
      </Button>
      <Dialog open={open()} onOpenChange={setOpen}>
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Stop PullUp on {where()}?</DialogTitle>
            <DialogDescription>
              PullUp stops posting to GitHub immediately: no reviews, no comments, no reviewer requests. Permits it already issued are refused
              when it tries to use them. Decisions still show here.
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="Reason (optional, saved in the evidence record)" value={reason()} onInput={(e) => setReason(e.currentTarget.value)} maxLength={200} />
          <Callout variant="note">
            <CalloutDescription>
              Resuming is only possible from the command line on the host: <code class="num">pnpm pullup resume{props.scope ? ` --repo ${props.scope}` : ""}</code>
            </CalloutDescription>
          </Callout>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void stop()} disabled={busy()} data-testid="confirm-stop">
              <Show when={busy()} fallback={<OctagonX class="size-4" />}>
                <Spinner size="sm" />
              </Show>
              Stop now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
