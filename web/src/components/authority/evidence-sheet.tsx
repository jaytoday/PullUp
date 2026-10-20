import { createResource, For, Show, type JSX } from "solid-js";
import { Callout, CalloutDescription, CalloutTitle } from "@/components/ui/callout";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type EvidenceResponse } from "@/lib/api";
import { dateTime, shortSha } from "@/lib/format";
import { safeLatest } from "@/lib/state";

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="space-y-1.5" data-section={props.title.toLowerCase()}>
      <h3 class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{props.title}</h3>
      <div class="rounded-md border border-border bg-background/40 px-3 py-2 text-sm">{props.children}</div>
    </section>
  );
}

function Fields(props: { value: Readonly<Record<string, unknown>> | null | undefined }) {
  return (
    <Show when={props.value} fallback={<span class="text-muted-foreground">—</span>}>
      {(v) => (
        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <For each={Object.entries(v()).filter(([, x]) => x !== null && x !== undefined)}>
            {([k, x]) => (
              <>
                <dt class="text-muted-foreground">{k}</dt>
                <dd class="num break-words">{typeof x === "object" ? JSON.stringify(x) : String(x)}</dd>
              </>
            )}
          </For>
        </dl>
      )}
    </Show>
  );
}

function Body(props: { e: EvidenceResponse }) {
  const e = () => props.e;
  return (
    <div class="space-y-4">
      <header class="space-y-2 pr-8">
        <SheetTitle class="text-lg font-semibold">Evidence · PR #{e().pullNumber ?? "?"}</SheetTitle>
        <SheetDescription class="num text-xs text-muted-foreground">
          task {e().taskId} · {e().repoId}
        </SheetDescription>
        <Show
          when={e().chain.ok}
          fallback={
            <Callout variant="danger" data-testid="chain-broken">
              <CalloutTitle>The evidence record was altered</CalloutTitle>
              <CalloutDescription>
                <For each={e().chain.breaks}>{(b) => <div class="num">row {b.seq}: {b.problem}</div>}</For>
              </CalloutDescription>
            </Callout>
          }
        >
          <p class="text-xs text-band-fast" data-testid="chain-ok">
            Hash chain intact ({e().chain.checked} rows in this repo's record). Every field below is read from those rows.
          </p>
        </Show>
      </header>
      <Section title="Why">{e().why ?? "—"}</Section>
      <Section title="What">
        <Fields value={e().what ? { ...e().what, headSha: e().what!.headSha ? shortSha(e().what!.headSha!) : null } : null} />
      </Section>
      <Section title="Risk">
        <Fields value={e().risk} />
      </Section>
      <Section title="Authority">
        <Fields value={e().authority} />
      </Section>
      <Section title="Action">
        <Fields value={e().action} />
      </Section>
      <Section title="Outcome">
        <Fields value={e().outcome ? { ...e().outcome, at: dateTime(e().outcome!.at) } : null} />
      </Section>
      <Section title="Validation">
        <Fields value={e().validation} />
      </Section>
      <Section title="Version">
        <Fields value={e().version} />
      </Section>
      <section class="space-y-1.5">
        <h3 class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Rows</h3>
        <ol class="num space-y-0.5 text-[11px] text-muted-foreground">
          <For each={e().rows}>
            {(r) => (
              <li>
                #{r.seq} {r.kind} · {dateTime(r.at)} · {r.hash.slice(0, 10)}
              </li>
            )}
          </For>
        </ol>
      </section>
    </div>
  );
}

/** The evidence record for one task: WHY · WHAT · RISK · AUTHORITY · ACTION · OUTCOME · VALIDATION · VERSION. */
export function EvidenceSheet(props: { taskId: string | null; onClose: () => void }) {
  const [evidence] = createResource(() => props.taskId, (id) => api.evidence(id));
  return (
    <Sheet open={props.taskId !== null} onOpenChange={(o) => !o && props.onClose()}>
      <SheetContent side="right" class="w-full sm:max-w-[640px]">
        <Show
          when={safeLatest(evidence)?.taskId === props.taskId ? safeLatest(evidence) : undefined}
          fallback={
            <Show
              when={evidence.error}
              fallback={
                <div class="space-y-3">
                  <Skeleton class="h-6 w-1/2" />
                  <Skeleton class="h-40" />
                </div>
              }
            >
              <Callout variant="danger">
                <CalloutTitle>Couldn't load the evidence</CalloutTitle>
                <CalloutDescription>{(evidence.error as Error).message}</CalloutDescription>
              </Callout>
            </Show>
          }
        >
          {(e) => <Body e={e()} />}
        </Show>
      </SheetContent>
    </Sheet>
  );
}
