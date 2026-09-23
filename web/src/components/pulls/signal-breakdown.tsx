import { createSignal, For, Show } from "solid-js";
import { ChevronDown, FileCode2 } from "lucide-solid";
import { ProbBar } from "@/components/shared/meters";
import type { PullDetail, UnitDetail } from "@/lib/api";
import { cn } from "@/lib/cn";
import { humanize, prob } from "@/lib/format";
import { DiffView } from "./diff-view";

function noulP(u: UnitDetail, id: string): number {
  const a = u.answers?.answers[id];
  return a && a.kind === "noul" ? a.p : 0;
}

/**
 * Per-hunk Jev answers: every risk question as a probability bar with its
 * thresholds (review / escalate), the injection tripwire, low-risk evidence,
 * change kind + blast radius — and the code they were asked about.
 */
export function SignalBreakdown(props: { detail: PullDetail }) {
  const t = () => props.detail.thresholds;
  const qs = () => props.detail.questionSet;
  const ticksFor = (q: string) =>
    q === qs().injection
      ? [{ at: t().injection, class: "bg-band-escalate", label: "escalate" }]
      : qs().escalating.includes(q)
        ? [
            { at: t().sensitiveMedium, class: "bg-band-review", label: "review" },
            { at: t().sensitiveHigh, class: "bg-band-escalate", label: "escalate" },
          ]
        : [{ at: t().sensitiveMedium, class: "bg-band-review", label: "review" }];

  return (
    <div class="space-y-3">
      <For each={props.detail.units} fallback={<p class="text-sm text-muted-foreground">No diff hunks stored for this PR.</p>}>
        {(u, i) => {
          const [open, setOpen] = createSignal(i() === 0);
          const riskQs = () =>
            [...qs().sensitive, qs().injection].map((q) => ({ q, p: noulP(u, q) })).sort((a, b) => b.p - a.p);
          const kind = () => {
            const a = u.answers?.answers.changeKind;
            return a && a.kind === "choice" ? a : null;
          };
          const blast = () => {
            const a = u.answers?.answers.blastRadius;
            return a && a.kind === "score" ? a : null;
          };
          return (
            <div class="rounded-md border border-border">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => setOpen(!open())}
                aria-expanded={open()}
              >
                <span class="flex min-w-0 items-center gap-2">
                  <FileCode2 class="size-3.5 shrink-0 text-muted-foreground" />
                  <span class="num truncate text-xs">{u.key}</span>
                </span>
                <span class="flex items-center gap-3 text-xs text-muted-foreground">
                  <Show
                    when={u.answers}
                    fallback={
                      <span class="text-band-review">{u.noPatch ? "no patch — not evaluable" : u.oversize ? "oversize — not evaluable" : "not evaluated yet"}</span>
                    }
                  >
                    <span>
                      max <span class="num text-foreground">{prob(riskQs()[0]?.p)}</span> {humanize(riskQs()[0]?.q ?? "")}
                    </span>
                  </Show>
                  <ChevronDown class={cn("size-4 transition-transform", open() && "rotate-180")} />
                </span>
              </button>
              <Show when={open()}>
                <div class="space-y-4 border-t border-border p-3">
                  <Show when={u.answers}>
                    <div class="grid gap-x-8 gap-y-2 md:grid-cols-2">
                      <For each={riskQs()}>
                        {(r) => (
                          <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-3 text-xs">
                            <span class={cn("truncate", r.q === qs().injection && "text-band-escalate")} title={r.q}>
                              {r.q === qs().injection ? "Injection tripwire" : humanize(r.q)}
                              <Show when={qs().escalating.includes(r.q)}>
                                <span class="ml-1 text-[10px] text-muted-foreground">▲</span>
                              </Show>
                            </span>
                            <ProbBar p={r.p} ticks={ticksFor(r.q)} />
                          </div>
                        )}
                      </For>
                    </div>
                    <div class="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-3 text-xs">
                      <For each={qs().lowRisk}>
                        {(q) => (
                          <span class="text-muted-foreground">
                            {humanize(q)} <span class="num text-foreground">{prob(noulP(u, q))}</span>
                          </span>
                        )}
                      </For>
                      <Show when={kind()}>
                        {(k) => (
                          <span class="text-muted-foreground">
                            change kind <span class="text-foreground">{k().choice}</span>{" "}
                            <span class="num">@{prob(k().confidence)}</span>
                          </span>
                        )}
                      </Show>
                      <Show when={blast()}>
                        {(b) => (
                          <span class="text-muted-foreground">
                            blast radius <span class="num text-foreground">{b().score.toFixed(1)}</span>/4
                          </span>
                        )}
                      </Show>
                    </div>
                  </Show>
                  <Show when={u.hunk}>
                    <DiffView hunk={u.hunk} />
                  </Show>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
      <p class="text-[11px] text-muted-foreground">
        ▲ escalating question · ticks mark the review ({t().sensitiveMedium}) and escalate ({t().sensitiveHigh}) thresholds · model{" "}
        <span class="num">{props.detail.modelId}</span> · questions <span class="num">{qs().version}</span>. State sent to the model is
        code only.
      </p>
    </div>
  );
}
