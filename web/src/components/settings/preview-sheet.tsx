import { A } from "@solidjs/router";
import { For, Show, type JSX } from "solid-js";
import { TriangleAlert } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Callout, CalloutDescription } from "@/components/ui/callout";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useRepo } from "@/components/layout/repo-context";
import type { ConfigPreview } from "@/lib/api";
import { hours, pct } from "@/lib/format";
import { safeLatest, withMode } from "@/lib/state";
import { useSettings } from "./settings-context";

function Row(props: { label: string; before: JSX.Element; after: JSX.Element; tone?: string; testid?: string }) {
  return (
    <div class="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0" data-testid={props.testid}>
      <span class="text-muted-foreground">{props.label}</span>
      <span class="num">
        {props.before} → <span class={props.tone ?? "text-foreground"}>{props.after}</span>
      </span>
    </div>
  );
}

const delta = (a: number, b: number) => (b === a ? "" : ` (${b > a ? "+" : ""}${b - a})`);

function Body(props: { p: ConfigPreview }) {
  const repo = useRepo();
  const h = () => props.p.history;
  const riskier = () =>
    h().newlyEligibleDefectRate !== null && h().baselineDefectRate !== null && h().newlyEligibleDefectRate! > h().baselineDefectRate!;
  return (
    <div class="space-y-6">
      <section class="space-y-1">
        <h3 class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Open PRs · {props.p.open.total}</h3>
        <Row label="Would approve" before={props.p.open.before.approve} after={`${props.p.open.after.approve}${delta(props.p.open.before.approve, props.p.open.after.approve)}`} testid="preview-approve" />
        <Row label="Ask a human" before={props.p.open.before.requestHuman} after={`${props.p.open.after.requestHuman}${delta(props.p.open.before.requestHuman, props.p.open.after.requestHuman)}`} />
        <Row label="Request changes" before={props.p.open.before.requestChanges} after={props.p.open.after.requestChanges} />
        <Row label="Actually sent (Act)" before={props.p.open.before.acting} after={props.p.open.after.acting} />
        <Row
          label="Median w*"
          before={props.p.maxWait.medianBefore === null ? "—" : hours(props.p.maxWait.medianBefore)}
          after={props.p.maxWait.medianAfter === null ? "—" : hours(props.p.maxWait.medianAfter)}
        />
      </section>

      <section class="space-y-2">
        <h3 class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Flipped PRs · {props.p.open.flipped.length}</h3>
        <Show when={props.p.open.flipped.length > 0} fallback={<p class="text-xs text-muted-foreground">No open PR changes outcome.</p>}>
          <ul class="space-y-1.5" data-testid="preview-flipped">
            <For each={props.p.open.flipped}>
              {(f) => (
                <li class="text-xs">
                  <A href={withMode(`/r/${repo.repoId()}/pulls/${f.pullNumber}`, repo.mode())} class="hover:text-primary">
                    <span class="num text-muted-foreground">#{f.pullNumber}</span> {f.title}
                  </A>
                  <div class="num text-muted-foreground">
                    {f.before} → <span class="text-foreground">{f.after}</span>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section class="space-y-1">
        <h3 class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">History · last {h().total} merged PRs</h3>
        <Row label="Inside the approval envelope" before={h().eligibleBefore} after={`${h().eligibleAfter}${delta(h().eligibleBefore, h().eligibleAfter)}`} testid="preview-history" />
        <Show when={h().newlyEligible.length > 0}>
          <div class="flex items-baseline justify-between gap-4 py-2 text-sm">
            <span class="text-muted-foreground">↳ newly eligible that later had a defect proxy</span>
            <span class={`num ${riskier() ? "text-band-escalate" : ""}`}>
              {h().newlyEligible.filter((x) => x.defectProxy).length} ({pct(h().newlyEligibleDefectRate)}) vs {pct(h().baselineDefectRate)} baseline
              <Show when={riskier()}>
                {" "}
                <TriangleAlert class="inline size-3.5" />
              </Show>
            </span>
          </div>
        </Show>
        <Show when={h().newlyBlocked.length > 0}>
          <div class="py-1 text-xs text-muted-foreground">{h().newlyBlocked.length} previously eligible PR(s) would now need a human.</div>
        </Show>
      </section>

      <Show when={props.p.rules.length > 0}>
        <section class="space-y-1" data-testid="preview-rules">
          <h3 class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Special cases</h3>
          <For each={props.p.rules}>
            {(r) => (
              <div class="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
                <span>{r.name}</span>
                <span class={`num text-xs ${r.open + r.history === 0 ? "text-band-review" : "text-muted-foreground"}`}>
                  {r.open} open · {r.history} recent merged{r.open + r.history === 0 ? " — matches nothing, check the globs" : ""}
                </span>
              </div>
            )}
          </For>
        </section>
      </Show>

      <Show when={props.p.notes.length > 0}>
        <Callout variant="warning">
          <CalloutDescription>
            <For each={props.p.notes}>{(n) => <div>{n}</div>}</For>
          </CalloutDescription>
        </Callout>
      </Show>
    </div>
  );
}

/** What-if results for the draft, against the saved settings. */
export function PreviewSheet() {
  const s = useSettings();
  return (
    <Sheet open={s.previewOpen()} onOpenChange={s.setPreviewOpen}>
      <SheetContent side="right" class="w-full sm:max-w-[560px]" data-testid="preview-sheet">
        <div class="space-y-5">
          <div class="space-y-1 pr-8">
            <SheetTitle class="text-lg font-semibold">Preview vs {safeLatest(s.server)?.version ? `v${safeLatest(s.server)!.version}` : "current settings"}</SheetTitle>
            <SheetDescription class="text-xs text-muted-foreground">
              Replays this repo's own data under your draft. Cached signals only — nothing is saved or sent.
            </SheetDescription>
          </div>
          <Show when={s.previewError()}>
            <Callout variant="danger">
              <CalloutDescription>{s.previewError()}</CalloutDescription>
            </Callout>
          </Show>
          <Show
            when={!s.previewLoading() && s.preview()}
            fallback={
              <Show when={s.previewLoading()} fallback={<Button onClick={() => void s.runPreview()}>Run preview</Button>}>
                <div class="space-y-3">
                  <Skeleton class="h-32" />
                  <Skeleton class="h-24" />
                </div>
              </Show>
            }
          >
            {(p) => <Body p={p()} />}
          </Show>
          <div class="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => s.setPreviewOpen(false)}>
              Close
            </Button>
            <Button onClick={() => { s.setPreviewOpen(false); s.setSaveOpen(true); }} disabled={!s.dirty() || s.issues().length > 0}>
              Save…
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
