import { ErrorBoundary, Match, Show, Suspense, Switch, type JSX, type ParentComponent } from "solid-js";
import { Play, RefreshCw, TriangleAlert } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Callout, CalloutDescription, CalloutTitle } from "@/components/ui/callout";
import { Spinner } from "@/components/ui/spinner";
import type { JevMode, ReportResponse } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { safeLatest } from "@/lib/state";
import { RepoProvider, useRepo } from "./repo-context";

const MODE_HINT: Record<JevMode, string> = {
  off: "Jev layer skipped — the plain two-cost report.",
  shadow: "Signals shown, recommendations unchanged (shows what active would do).",
  active: "Policy hits and escalations take effect. Approval stays logged-only.",
};

function TopBar() {
  const repo = useRepo();
  const generated = () => safeLatest(repo.report)?.report.generatedAt;
  return (
    <header class="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/85 px-6 backdrop-blur">
      <div class="flex min-w-0 items-center gap-3">
        <span class="truncate font-medium">{repo.repoId()}</span>
        <Show when={generated()}>
          <span class="num hidden text-xs text-muted-foreground md:inline" title={generated()}>
            as of {dateTime(generated()!)}
          </span>
        </Show>
        <Show when={repo.report.loading && generated()}>
          <Spinner size="sm" class="text-muted-foreground" />
        </Show>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip openDelay={300}>
          <TooltipTrigger as="div">
            <ToggleGroup
              type="single"
              size="sm"
              value={repo.mode()}
              onChange={(v) => v && repo.setMode(v as JevMode)}
              aria-label="Jev layer view mode"
            >
              <ToggleGroupItem value="off">Off</ToggleGroupItem>
              <ToggleGroupItem value="shadow">Shadow</ToggleGroupItem>
              <ToggleGroupItem value="active">Active</ToggleGroupItem>
            </ToggleGroup>
          </TooltipTrigger>
          <TooltipContent class="max-w-72">
            <div class="font-medium">View mode · {repo.mode()}</div>
            <div class="text-muted-foreground">{MODE_HINT[repo.mode()]} Changes this view only — never your config.</div>
          </TooltipContent>
        </Tooltip>
        <Button size="sm" variant="secondary" onClick={() => repo.refresh()} aria-label="Refresh">
          <RefreshCw class="size-3.5" />
        </Button>
        <Button size="sm" onClick={() => void repo.runSignals()} disabled={repo.busy() !== null}>
          <Show when={repo.busy() === "Run signals"} fallback={<Play class="size-3.5" />}>
            <Spinner size="sm" />
          </Show>
          Run signals
        </Button>
      </div>
    </header>
  );
}

/** Page title row shared by every repo page. */
export function PageHeader(props: { title: string; description?: JSX.Element; actions?: JSX.Element }) {
  return (
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{props.title}</h1>
        <Show when={props.description}>
          <p class="max-w-2xl text-sm text-muted-foreground">{props.description}</p>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="flex items-center gap-2">{props.actions}</div>
      </Show>
    </div>
  );
}

/** Notes from the report (synthetic model, uncalibrated, unevaluated units…). */
export function ReportNotes() {
  const repo = useRepo();
  const notes = () => safeLatest(repo.report)?.report.risk?.notes ?? [];
  return (
    <Show when={notes().length > 0}>
      <div class="flex flex-wrap gap-2">
        {notes().map((n) => (
          <span class="inline-flex items-center gap-1.5 rounded-md border border-band-review/30 bg-band-review/8 px-2 py-1 text-xs text-band-review">
            <TriangleAlert class="size-3" />
            {n}
          </span>
        ))}
      </div>
    </Show>
  );
}

export function PageSkeleton() {
  return (
    <div class="space-y-4">
      <Skeleton class="h-8 w-64" />
      <div class="grid grid-cols-4 gap-4">
        <Skeleton class="h-28" />
        <Skeleton class="h-28" />
        <Skeleton class="h-28" />
        <Skeleton class="h-28" />
      </div>
      <Skeleton class="h-72" />
    </div>
  );
}

export function LoadError(props: { error: Error; reset: () => void }) {
  return (
    <Callout variant="danger" class="max-w-xl">
      <CalloutTitle>Couldn't load this view</CalloutTitle>
      <CalloutDescription>
        <p class="mb-3">{props.error.message}</p>
        <Button size="sm" variant="secondary" onClick={props.reset}>
          Try again
        </Button>
      </CalloutDescription>
    </Callout>
  );
}

export const RepoLayout: ParentComponent = (props) => (
  <RepoProvider>
    <TopBar />
    <main class="mx-auto w-full max-w-[1400px] flex-1 px-6 py-6">
      <ErrorBoundary fallback={(err, reset) => <LoadError error={err} reset={reset} />}>
        <Suspense fallback={<PageSkeleton />}>{props.children}</Suspense>
      </ErrorBoundary>
    </main>
  </RepoProvider>
);


/** Renders children with the latest report (no skeleton flash on refetch). */
export function WithReport(props: { children: (data: ReportResponse) => JSX.Element }) {
  const repo = useRepo();
  // Error first (reading .latest on an errored resource throws); keyed so the
  // page re-renders with each fresh report (e.g. after Run signals).
  return (
    <Switch fallback={<PageSkeleton />}>
      <Match when={repo.report.error}>
        <LoadError error={repo.report.error as Error} reset={() => repo.refresh()} />
      </Match>
      <Match when={repo.report.latest} keyed>
        {(data) => props.children(data)}
      </Match>
    </Switch>
  );
}
