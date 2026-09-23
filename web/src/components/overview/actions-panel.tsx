import { For, Show } from "solid-js";
import { Send } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dynamic } from "solid-js/web";
import { Panel } from "@/components/shared/panel";
import { useRepo } from "@/components/layout/repo-context";
import type { PlannedReviewAction } from "@/lib/api";
import { ACTIONS, type BotAction } from "@/lib/meta";
import { withMode } from "@/lib/state";

/** What the review bot would do right now — and a button to log (not send) it. */
export function ActionsPanel(props: { planned: readonly PlannedReviewAction[] }) {
  const repo = useRepo();
  const count = (a: BotAction) => props.planned.filter((p) => p.action === a).length;
  return (
    <Panel
      label="Bot review actions"
      href={withMode(`/r/${repo.repoId()}/actions`, repo.mode())}
      class="lg:col-span-5"
      aside={<span class="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">LOGGED ONLY</span>}
    >
      <div class="space-y-4">
        <div class="grid grid-cols-3 gap-3">
          <For each={Object.keys(ACTIONS) as BotAction[]}>
            {(a) => (
              <div class="rounded-md border border-border bg-background/40 p-3">
                <div class={`num text-2xl font-medium ${count(a) ? ACTIONS[a].text : "text-muted-foreground"}`}>{count(a)}</div>
                <div class={`mt-1.5 flex items-center gap-1.5 text-xs ${ACTIONS[a].text}`}>
                  <Dynamic component={ACTIONS[a].icon} class="size-3.5 shrink-0" />
                  <span class="truncate text-foreground/85">{ACTIONS[a].label}</span>
                </div>
              </div>
            )}
          </For>
        </div>
        <p class="text-xs leading-relaxed text-muted-foreground">
          Planned from current decisions as GitHub PR reviews (<code class="num">APPROVE</code> · <code class="num">REQUEST_CHANGES</code> ·{" "}
          <code class="num">COMMENT</code> + reviewers). Approval authority is stubbed: logging records the exact call and sends nothing.
        </p>
        <Button size="sm" variant="secondary" disabled={repo.busy() !== null || props.planned.length === 0} onClick={() => void repo.logActions()}>
          <Show when={repo.busy() === "Log review actions"} fallback={<Send class="size-3.5" />}>
            <Spinner size="sm" />
          </Show>
          Log {props.planned.length} action{props.planned.length === 1 ? "" : "s"}
        </Button>
      </div>
    </Panel>
  );
}
