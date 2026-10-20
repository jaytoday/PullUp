import { createResource, For, Show } from "solid-js";
import { KeyRound } from "lucide-solid";
import { Dot } from "@/components/shared/badges";
import { Panel } from "@/components/shared/panel";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { safeLatest } from "@/lib/state";
import { StopDialog } from "./stop-dialog";

const STATUS_DOT: Record<string, string> = { approved: "bg-band-fast", pending: "bg-band-review", quarantined: "bg-band-escalate" };

/** Operator view of PullUp's authority: the global stop switch, sending prerequisites, and the agent registry. */
export function GlobalAuthorityPanel() {
  const [control, { refetch }] = createResource(() => api.control());
  const c = () => safeLatest(control);
  const prereq = (ok: boolean, label: string, hint: string) => (
    <div class="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs" title={hint}>
      <KeyRound class="size-3.5 text-muted-foreground" />
      {label}
      <span class={`ml-auto ${ok ? "text-band-fast" : "text-muted-foreground"}`}>{ok ? "ready" : "not set"}</span>
    </div>
  );

  return (
    <Panel label="Authority" aside={<StopDialog disabled={!c() || c()!.stop.stopped} onStopped={() => void refetch()} />}>
      <Show when={c()}>
        {(x) => (
          <div class="grid grid-cols-1 gap-5 lg:grid-cols-3" data-testid="global-authority">
            <div class="space-y-2" data-testid="global-stop" data-stopped={x().stop.stopped ? "true" : "false"}>
              <Dot class={x().stop.stopped ? "bg-band-escalate" : "bg-band-fast"} label={x().stop.stopped ? "Stopped everywhere" : "Running"} pulse={x().stop.stopped} />
              <Show when={x().stop.stopped}>
                <p class="text-xs text-muted-foreground">
                  By {x().stop.by} at {dateTime(x().stop.at)}
                  {x().stop.reason ? ` — ${x().stop.reason}` : ""}. Resume with <code class="num">pnpm pullup resume</code>.
                </p>
              </Show>
              <p class="text-xs text-muted-foreground">
                This dashboard is <span class="num">{x().agent.id}</span> version <span class="num">{x().agent.version.slice(0, 8)}</span> ({x().agent.status}).
              </p>
            </div>
            <div class="space-y-2">
              {prereq(x().delivery === "live", "Live delivery (PULLUP_GITHUB_DELIVERY)", "Operator setting; logged only otherwise")}
              {prereq(x().permitKey, "Permit key (PULLUP_PERMIT_KEY)", "Without it every live send is denied")}
              {prereq(x().credential === "app", `GitHub App credential${x().credential === "standing-token" ? " (personal token: comments only)" : ""}`, "Acting needs an App token scoped per action")}
            </div>
            <div class="space-y-1.5">
              <div class="text-[11px] text-muted-foreground">Agent versions</div>
              <Show when={x().agents.length > 0} fallback={<p class="text-xs text-muted-foreground">None registered yet. Run <code class="num">pnpm pullup agents</code>.</p>}>
                <ul class="space-y-1 text-xs" data-testid="agent-registry">
                  <For each={x().agents}>
                    {(a) => (
                      <li class="flex items-center gap-2">
                        <span class={`size-2 rounded-full ${STATUS_DOT[a.status]}`} />
                        <span class="num">{a.agentId}</span>
                        <span class="num text-muted-foreground">{a.version.slice(0, 8)}</span>
                        <span class="ml-auto text-muted-foreground">{a.status}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <p class="text-[11px] text-muted-foreground">
                Approve or quarantine from the CLI: <code class="num">pnpm pullup agents approve|quarantine &lt;version&gt;</code>
              </p>
            </div>
          </div>
        )}
      </Show>
    </Panel>
  );
}
