"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setRepoMode } from "@/app/(app)/settings/actions";
import { ModeBadge } from "@/components/runs/result-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

/** One repository's mode. Going active is the step that lets PullUp fail runs and ask people, so it is confirmed by typing the name. */
export function RepoMode({ repo, mode }: { repo: string; mode: "shadow" | "active" }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const change = (next: "shadow" | "active") =>
    start(async () => {
      try {
        await setRepoMode(repo, next, typed);
        setOpen(false);
        setTyped("");
        toast.success(next === "active" ? `${repo} is active` : `${repo} is back in shadow mode`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid={`repo-${repo}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm text-foreground">{repo}</span>
        <ModeBadge mode={mode} />
      </div>
      {mode === "active" ? (
        <Button color="neutral" variant="outline" size="sm" loading={pending} onClick={() => change("shadow")}>
          Back to shadow mode
        </Button>
      ) : (
        <Button color="primary" size="sm" onClick={() => setOpen(true)}>
          Make active
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make {repo} active?</DialogTitle>
            <DialogDescription>
              In active mode the PullUp check passes or fails runs, and questions the council cannot settle are sent to the person in the repo&apos;s config. If branch protection requires the PullUp check, a fail blocks merging.
            </DialogDescription>
          </DialogHeader>
          <FormField label={`Type ${repo} to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </FormField>
          <DialogFooter>
            <Button color="neutral" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button color="primary" disabled={typed.trim() !== repo} loading={pending} onClick={() => change("active")}>
              Make active
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
