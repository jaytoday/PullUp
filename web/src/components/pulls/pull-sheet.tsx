import { createResource, For, Show, type JSX } from "solid-js";
import { Callout, CalloutDescription, CalloutTitle } from "@/components/ui/callout";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CostCurveChart } from "@/components/charts/cost-curve-chart";
import { BandBadge, RecBadge } from "@/components/shared/badges";
import { useRepo } from "@/components/layout/repo-context";
import { api, type PullDetail } from "@/lib/api";
import { devHours, hours, num, pct, shortSha } from "@/lib/format";
import { safeLatest } from "@/lib/state";
import { ActionPreview } from "./action-preview";
import { SignalBreakdown } from "./signal-breakdown";

function Section(props: { title: string; children: JSX.Element; aside?: JSX.Element }) {
  return (
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{props.title}</h3>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

function Stat(props: { label: string; value: JSX.Element; tone?: string }) {
  return (
    <div class="rounded-md border border-border bg-background/40 px-3 py-2">
      <div class="text-[11px] text-muted-foreground">{props.label}</div>
      <div class={`num mt-0.5 text-sm ${props.tone ?? ""}`}>{props.value}</div>
    </div>
  );
}

function Detail(props: { d: PullDetail }) {
  const dec = () => props.d.decision;
  const risk = () => dec().risk;
  const policyHits = () => props.d.policy.hits;
  const injection = () => (risk()?.escalateReasons ?? []).filter((r) => r.startsWith("injection"));
  return (
    <div class="space-y-6">
      <header class="space-y-3 pr-8">
        <div class="flex flex-wrap items-center gap-2">
          <span class="num text-sm text-muted-foreground">#{props.d.pull.number}</span>
          <Show when={risk()}>{(r) => <BandBadge band={r().band} />}</Show>
          <Show when={!(dec().recommendation === "escalate" && risk()?.band === "escalate")}>
            <RecBadge rec={dec().recommendation} />
          </Show>
          <Show when={risk()?.shadowRecommendation && risk()!.shadowRecommendation !== dec().recommendation}>
            <span class="text-xs text-band-review">active → {risk()!.shadowRecommendation}</span>
          </Show>
        </div>
        <SheetTitle class="text-xl font-semibold leading-snug tracking-tight">{props.d.pull.title}</SheetTitle>
        <SheetDescription class="text-xs text-muted-foreground">
          {props.d.pull.author} · {props.d.pull.changeType} · {props.d.pull.area} · size {props.d.pull.sizeBucket} ·{" "}
          <span class="num text-band-fast">+{props.d.pull.additions}</span> <span class="num text-band-escalate">−{props.d.pull.deletions}</span> ·{" "}
          <span class="num">{shortSha(props.d.pull.headSha)}</span>
        </SheetDescription>
        <p class="text-sm text-muted-foreground">{dec().reason}</p>
      </header>

      <Show when={policyHits().length > 0}>
        <Callout variant="danger">
          <CalloutTitle>Policy requires a human</CalloutTitle>
          <CalloutDescription>
            <For each={policyHits()}>
              {(h) => (
                <div>
                  <span class="num">{h.path}</span> matches <span class="num">{h.rule}</span>
                </div>
              )}
            </For>
            <div class="mt-1 opacity-80">Deterministic and authoritative — no model signal can clear it.</div>
          </CalloutDescription>
        </Callout>
      </Show>
      <Show when={injection().length > 0}>
        <Callout variant="danger">
          <CalloutTitle>Injection tripwire</CalloutTitle>
          <CalloutDescription>
            The diff contains text addressed to reviewers or bots claiming approval. Treat it as a red flag, never as evidence of review.{" "}
            <span class="num">{injection().join("; ")}</span>
          </CalloutDescription>
        </Callout>
      </Show>
      <Show when={risk()?.band === "review-with-rationale"}>
        <Callout variant="warning">
          <CalloutTitle>Needs a reviewer with a written rationale</CalloutTitle>
          <CalloutDescription>{risk()!.reviewReasons.join(" · ")}</CalloutDescription>
        </Callout>
      </Show>
      <Show when={risk()?.fastPathEligible}>
        <Callout variant="success">
          <CalloutTitle>Fast-path eligible</CalloutTitle>
          <CalloutDescription>
            Allowlisted low-risk change with every signal high-confidence. This is a <em>logged would-be approval</em> — it never lowers risk.
          </CalloutDescription>
        </Callout>
      </Show>

      <Section title="Two-cost economics">
        <CostCurveChart points={props.d.curve} wait={dec().waitHours} wStar={dec().maxWaitHours} shadowWStar={risk()?.shadowMaxWaitHours} />
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Waited" value={hours(dec().waitHours)} tone={dec().waitHours >= dec().maxWaitHours ? "text-primary" : ""} />
          <Stat label="Max wait w*" value={hours(dec().maxWaitHours)} tone="text-primary" />
          <Stat label="Delay cost D(w)" value={devHours(dec().delayCost)} tone="text-clay" />
          <Stat label="Defect cost E(w)" value={devHours(dec().expectedDefectCost)} tone="text-band-review" />
          <Stat label="Marginal delay" value={`${num(dec().marginalDelayPerHour, 3)} /h`} />
          <Stat label="Marginal review benefit" value={`${num(dec().marginalReviewBenefitPerHour, 3)} /h`} />
          <Show when={risk()}>
            {(r) => (
              <>
                <Stat label="P(defect)" value={pct(r().pDefect)} />
                <Stat label="Risk multiplier m" value={`×${r().multiplier}${r().calibrated ? "" : " (uncal.)"}`} />
              </>
            )}
          </Show>
        </div>
      </Section>

      <Show when={risk()}>
        <Section title="Jev risk signals · per hunk">
          <SignalBreakdown detail={props.d} />
        </Section>
      </Show>

      <Section title="Bot review action">
        <ActionPreview detail={props.d} />
      </Section>
    </div>
  );
}

/** Right-hand PR detail sheet, deep-linkable at /r/:owner/:repo/pulls/:n. */
export function PullSheet(props: { pullNumber: number | null; onClose: () => void }) {
  const repo = useRepo();
  const [detail] = createResource(
    () => (props.pullNumber === null ? false : { n: props.pullNumber, repo: repo.repoId(), mode: repo.mode(), v: repo.version() }),
    (k) => api.pull(k.repo, k.n, k.mode),
  );
  return (
    <Sheet open={props.pullNumber !== null} onOpenChange={(o) => !o && props.onClose()}>
      <SheetContent side="right" class="w-full sm:max-w-[780px]">
        <Show
          when={safeLatest(detail)?.pull.number === props.pullNumber ? safeLatest(detail) : undefined}
          fallback={
            <Show
              when={detail.error}
              fallback={
                <div class="space-y-4">
                  <Skeleton class="h-6 w-2/3" />
                  <Skeleton class="h-4 w-1/2" />
                  <Skeleton class="h-56" />
                  <Skeleton class="h-40" />
                </div>
              }
            >
              <Callout variant="danger">
                <CalloutTitle>Couldn't load PR #{props.pullNumber}</CalloutTitle>
                <CalloutDescription>{(detail.error as Error).message}</CalloutDescription>
              </Callout>
            </Show>
          }
        >
          {(d) => <Detail d={d()} />}
        </Show>
      </SheetContent>
    </Sheet>
  );
}
