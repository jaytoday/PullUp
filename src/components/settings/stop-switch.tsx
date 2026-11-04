"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setStopped } from "@/app/(app)/settings/actions";
import { Switch } from "@/components/ui/switch";

/** The stop switch: while on, nothing is posted to GitHub (every refused call is still recorded). */
export function StopSwitch({ stopped, forcedByEnv }: { stopped: boolean; forcedByEnv: boolean }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-start justify-between gap-4 px-4 py-3">
      <span>
        <span className="block text-sm font-medium text-foreground">Stop posting to GitHub</span>
        <span className="block text-sm text-muted-foreground">{forcedByEnv ? "On through PULLUP_STOP=1 on the server." : "PullUp keeps deciding and recording, but sends no check runs or comments."}</span>
      </span>
      <Switch
        checked={stopped}
        disabled={pending || forcedByEnv}
        aria-label="Stop posting to GitHub"
        onCheckedChange={(on) =>
          start(async () => {
            await setStopped(on);
            toast(on ? "Stopped: nothing is posted to GitHub" : "Posting to GitHub again");
          })
        }
      />
    </label>
  );
}
