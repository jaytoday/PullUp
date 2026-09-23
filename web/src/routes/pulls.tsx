import { useNavigate, useParams } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Search } from "lucide-solid";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader, ReportNotes, WithReport } from "@/components/layout/repo-layout";
import { useRepo } from "@/components/layout/repo-context";
import { PullSheet } from "@/components/pulls/pull-sheet";
import { PullTable } from "@/components/pulls/pull-table";
import { BAND_ORDER, BANDS } from "@/lib/meta";
import { withMode } from "@/lib/state";

type Scope = "open" | "all";

export default function Pulls() {
  const repo = useRepo();
  const params = useParams<{ n?: string }>();
  const navigate = useNavigate();
  const [scope, setScope] = createSignal<Scope>("open");
  const [band, setBand] = createSignal<string>("all");
  const [query, setQuery] = createSignal("");
  const selected = () => (params.n ? Number(params.n) : null);
  const close = () => navigate(withMode(`/r/${repo.repoId()}/pulls`, repo.mode()), { scroll: false });

  return (
    <WithReport>
      {(data) => {
        const filtered = createMemo(() => {
          const q = query().trim().toLowerCase();
          return data.report.decisions.filter(
            (d) =>
              (scope() === "all" || d.state === "open") &&
              (band() === "all" || d.risk?.band === band()) &&
              (!q || `#${d.pullNumber} ${d.title} ${d.author} ${d.changeType} ${d.area}`.toLowerCase().includes(q)),
          );
        });
        const bandCount = (b: string) => data.report.decisions.filter((d) => d.state === "open" && d.risk?.band === b).length;
        return (
          <div class="space-y-5">
            <PageHeader
              title="PR queue"
              description="Every open PR against its max-wait threshold w*: once the wait passes w*, more review no longer pays for itself."
            />
            <ReportNotes />
            <div class="flex flex-wrap items-center gap-3">
              <ToggleGroup type="single" size="sm" value={scope()} onChange={(v) => v && setScope(v as Scope)} aria-label="Scope">
                <ToggleGroupItem value="open">Open</ToggleGroupItem>
                <ToggleGroupItem value="all">All</ToggleGroupItem>
              </ToggleGroup>
              <Show when={data.report.risk}>
                <ToggleGroup type="single" size="sm" value={band()} onChange={(v) => setBand(v || "all")} aria-label="Band filter">
                  <ToggleGroupItem value="all">All bands</ToggleGroupItem>
                  <For each={BAND_ORDER}>
                    {(b) => (
                      <ToggleGroupItem value={b}>
                        <span class={`size-1.5 rounded-full ${BANDS[b].fill}`} />
                        {BANDS[b].label}
                        <span class="num text-muted-foreground">{bandCount(b)}</span>
                      </ToggleGroupItem>
                    )}
                  </For>
                </ToggleGroup>
              </Show>
              <label class="ml-auto flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm focus-within:ring-1 focus-within:ring-ring">
                <Search class="size-3.5 text-muted-foreground" />
                <input
                  type="search"
                  placeholder="Filter by #, title, author…"
                  class="w-56 bg-transparent outline-none placeholder:text-muted-foreground"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  aria-label="Filter PRs"
                />
              </label>
            </div>
            <PullTable decisions={filtered()} actions={data.actions} selected={selected() ?? undefined} />
            <p class="text-xs text-muted-foreground">
              Showing <span class="num">{filtered().length}</span> PRs. Meter: teal tick = w*
              <Show when={repo.mode() === "shadow"}>, ochre tick = w* if active mode were on</Show>.
            </p>
            <PullSheet pullNumber={selected()} onClose={close} />
          </div>
        );
      }}
    </WithReport>
  );
}
