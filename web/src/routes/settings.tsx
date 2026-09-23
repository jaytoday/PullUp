import { For, Show, type JSX } from "solid-js";
import { KeyRound } from "lucide-solid";
import { Dot } from "@/components/shared/badges";
import { Panel } from "@/components/shared/panel";
import { PageHeader, PageSkeleton } from "@/components/layout/repo-layout";
import { useApp } from "@/components/layout/app-context";
import { humanize } from "@/lib/format";

function Row(props: { k: string; v: JSX.Element; from?: boolean }) {
  return (
    <div class="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span class="text-muted-foreground">
        {props.k}
        <Show when={props.from}>
          <span class="ml-1.5 rounded bg-primary/15 px-1 text-[10px] text-primary">file</span>
        </Show>
      </span>
      <span class="num text-right text-xs">{props.v}</span>
    </div>
  );
}

/** Read-only view of the resolved config. Secrets appear as presence only. */
export default function Settings() {
  const { config } = useApp();
  return (
    <main class="mx-auto w-full max-w-[1400px] flex-1 px-6 py-6">
      <Show when={config()} fallback={<PageSkeleton />}>
        {(c) => (
          <div class="space-y-5">
            <PageHeader
              title="Settings"
              description={
                <>
                  Resolved from <span class="num">{c().path ?? "defaults (no pullup.config.json)"}</span>. Read-only here — edit the file and reload.
                </>
              }
            />
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Panel label="Signal model">
                <div class="space-y-3">
                  <Dot
                    class={c().env.signalModel === "jev" ? "bg-band-fast" : "bg-band-review"}
                    label={c().env.signalModel === "jev" ? "Live Jev (TypeSafe API)" : "Deterministic synthetic stand-in"}
                  />
                  <Row k="model id" v={c().env.signalModelId} />
                  <Row k="pinned Jev model" v={c().jev.model} />
                  <Row k="question set" v={c().jev.questionSet} />
                  <div class="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
                    <KeyRound class="size-3.5 text-muted-foreground" />
                    TYPESAFE_API_KEY
                    <span class={`ml-auto ${c().env.typesafeApiKey ? "text-band-fast" : "text-muted-foreground"}`}>
                      {c().env.typesafeApiKey ? "present" : "not set"}
                    </span>
                  </div>
                </div>
              </Panel>
              <Panel label="Jev layer">
                <Row k="configured mode" v={c().jev.mode} />
                <Row k="multiplier bounds" v={`${c().jev.multiplierMin} – ${c().jev.multiplierMax} (applied ≥ 1)`} />
                <Row k="budget per run" v={`$${c().jev.budgetUsdPerRun}`} />
                <Row k="concurrency · rpm" v={`${c().jev.concurrency} · ${c().jev.requestsPerMinute}`} />
                <Row k="calibration path" v={c().jev.calibrationPath ?? "auto (.pullup/)"} />
                <Row k="human reviewers" v={c().jev.humanReviewers.join(", ") || "—"} />
              </Panel>
              <Panel label="Thresholds">
                <For each={Object.entries(c().jev.thresholds)}>{([k, v]) => <Row k={humanize(k)} v={v} />}</For>
              </Panel>
            </div>
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel label="Policy · always requires a human">
                <div class="flex flex-wrap gap-1.5">
                  <For each={c().policy.requireHumanGlobs}>
                    {(g) => <code class="num rounded border border-band-escalate/30 bg-band-escalate/8 px-1.5 py-0.5 text-xs text-band-escalate">{g}</code>}
                  </For>
                  <Show when={c().policy.lockfileWithoutManifest}>
                    <code class="num rounded border border-band-escalate/30 bg-band-escalate/8 px-1.5 py-0.5 text-xs text-band-escalate">lockfile without manifest</code>
                  </Show>
                </div>
                <div class="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Allowlisted (fast-path eligible)</div>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <For each={Object.entries(c().policy.allowlist)}>
                    {([cat, globs]) => (
                      <For each={globs}>
                        {(g) => (
                          <code class="num rounded border border-band-fast/30 bg-band-fast/8 px-1.5 py-0.5 text-xs text-band-fast" title={cat}>
                            {g}
                          </code>
                        )}
                      </For>
                    )}
                  </For>
                </div>
              </Panel>
              <Panel label="Cost priors">
                <div class="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  <For each={Object.entries(c().priors).filter(([, v]) => typeof v === "number")}>
                    {([k, v]) => <Row k={humanize(k)} v={String(v)} from={c().fileOverrides.includes(k)} />}
                  </For>
                </div>
              </Panel>
            </div>
          </div>
        )}
      </Show>
    </main>
  );
}
