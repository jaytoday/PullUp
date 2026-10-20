import { createResource, Show } from "solid-js";
import { Dot } from "@/components/shared/badges";
import { Panel } from "@/components/shared/panel";
import { api } from "@/lib/api";
import { safeLatest } from "@/lib/state";
import { StopDialog } from "./stop-dialog";

const AGENT_STATUS: Record<string, { dot: string; label: string; hint: string }> = {
  approved: { dot: "bg-band-fast", label: "Approved", hint: "This exact version may act within the repo's profile." },
  pending: { dot: "bg-band-review", label: "Not approved yet", hint: "May only comment until an operator approves it with pnpm pullup agents approve." },
  quarantined: { dot: "bg-band-escalate", label: "Quarantined", hint: "Every send from this version is denied." },
  unknown: { dot: "bg-band-escalate", label: "Unknown", hint: "Its version could not be determined, so every send is denied." },
};

/**
 * What PullUp is *allowed* to send on this repo — separate from what it
 * decides: the enrolled capability profile (the ceiling), whether this
 * version of PullUp is approved, and the stop switch.
 */
export function AuthorityPanel(props: { repoId: string; version?: number }) {
  const [control, { refetch }] = createResource(
    () => ({ id: props.repoId, v: props.version }),
    (k) => api.repoControl(k.id),
  );
  const c = () => safeLatest(control);
  const stopped = () => c()?.stop === null || c()?.stop?.stopped === true;

  return (
    <Panel label="Authority" aside={<StopDialog scope={props.repoId} disabled={!c() || stopped()} onStopped={() => void refetch()} />}>
      <Show when={c()}>
        {(x) => (
          <div class="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3" data-testid="authority-panel">
            <div class="space-y-1">
              <div class="text-[11px] text-muted-foreground">Capability profile</div>
              <div class="font-medium" data-profile={x().profile.id}>
                {x().profile.label}
                <Show when={!x().profile.enrolled}>
                  <span class="ml-1.5 text-xs font-normal text-muted-foreground">(not enrolled)</span>
                </Show>
              </div>
              <p class="text-xs text-muted-foreground">
                {x().profile.hint}{" "}
                <Show when={!x().profile.enrolled}>
                  Enroll with <code class="num">pnpm pullup enroll {x().repoId} review</code>.
                </Show>
              </p>
            </div>
            <div class="space-y-1">
              <div class="text-[11px] text-muted-foreground">This PullUp version</div>
              <Dot class={AGENT_STATUS[x().agent.status]!.dot} label={AGENT_STATUS[x().agent.status]!.label} />
              <p class="text-xs text-muted-foreground">
                <span class="num">{x().agent.id} · {x().agent.version.slice(0, 8)}</span> — {AGENT_STATUS[x().agent.status]!.hint}
              </p>
            </div>
            <div class="space-y-1" data-testid="stop-state" data-stopped={stopped() ? "true" : "false"}>
              <div class="text-[11px] text-muted-foreground">Stop switch</div>
              <Dot class={stopped() ? "bg-band-escalate" : "bg-band-fast"} label={stopped() ? "Stopped" : "Running"} pulse={stopped()} />
              <p class="text-xs text-muted-foreground">
                <Show
                  when={stopped()}
                  fallback="Stopping blocks every GitHub write at once. Only the CLI can resume."
                >
                  {x().stop === null ? "The stop switch could not be read, so every send is denied." : `Stopped ${x().stop!.reason}. Resume with `}
                  <Show when={x().stop !== null}>
                    <code class="num">pnpm pullup resume{x().repoStop?.stopped ? ` --repo ${x().repoId}` : ""}</code>.
                  </Show>
                </Show>
              </p>
            </div>
          </div>
        )}
      </Show>
    </Panel>
  );
}
