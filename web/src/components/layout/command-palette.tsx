import { useNavigate } from "@solidjs/router";
import { createResource, createSignal, For, Show, type Component } from "solid-js";
import { BarChart3, Database, FlaskConical, GitPullRequest, History, LayoutGrid, Settings } from "lucide-solid";
import {
  CommandDialog,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { api } from "@/lib/api";
import { safeLatest, useActiveRepo, useMode, withMode } from "@/lib/state";
import { useApp } from "./app-context";

const [open, setOpen] = createSignal(false);
export const openPalette = () => setOpen(true);

interface Entry {
  readonly title: string;
  readonly subtitle?: string;
  readonly keywords?: readonly string[];
  readonly icon: Component<{ class?: string }>;
  readonly path: string;
}

function matches(e: Entry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [e.title, e.subtitle ?? "", ...(e.keywords ?? [])].some((s) => s.toLowerCase().includes(q));
}

const PAGES = [
  { path: "", title: "Overview", icon: LayoutGrid },
  { path: "/pulls", title: "PR queue", icon: GitPullRequest },
  { path: "/actions", title: "Review actions", icon: History },
  { path: "/calibration", title: "Calibration", icon: FlaskConical },
  { path: "/analytics", title: "Analytics", icon: BarChart3 },
] as const;

/**
 * ⌘K: jump to a page, a repo, or an open PR. Filtering happens here (not per
 * item) so empty groups disappear and "No matches" only shows when nothing does.
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const { repos } = useApp();
  const activeRepo = useActiveRepo();
  const [mode] = useMode();
  // Only fetched while the palette is open for a repo.
  const [report] = createResource(
    () => (open() && activeRepo() ? { repo: activeRepo()!, mode: mode() } : false),
    (k) => api.report(k.repo, k.mode),
  );
  const go = (path: string) => {
    setOpen(false);
    navigate(withMode(path, mode()));
  };

  const groups = (): Array<{ heading: string; entries: Entry[] }> => {
    const repo = activeRepo();
    const out: Array<{ heading: string; entries: Entry[] }> = [];
    if (repo) {
      out.push({ heading: repo, entries: PAGES.map((p) => ({ ...p, path: `/r/${repo}${p.path}` })) });
      out.push({
        heading: "Open PRs",
        entries: (safeLatest(report)?.report.decisions ?? [])
          .filter((d) => d.state === "open")
          .map((d) => ({
            title: `#${d.pullNumber} ${d.title}`,
            subtitle: `${d.changeType} · ${d.risk?.band ?? d.recommendation}`,
            keywords: [String(d.pullNumber), d.area, d.author],
            icon: GitPullRequest,
            path: `/r/${repo}/pulls/${d.pullNumber}`,
          })),
      });
    }
    out.push({
      heading: "Repositories",
      entries: (repos() ?? []).map((r) => ({
        title: r.repoId,
        subtitle: `${r.open} open · ${r.pulls} PRs`,
        icon: Database,
        path: `/r/${r.repoId}`,
      })),
    });
    out.push({ heading: "App", entries: [{ title: "Settings", icon: Settings, path: "/settings" }] });
    return out;
  };

  return (
    <CommandDialog open={open()} onOpenChange={setOpen}>
      {(ctx) => {
        const visible = () =>
          groups()
            .map((g) => ({ ...g, entries: g.entries.filter((e) => matches(e, ctx.search())) }))
            .filter((g) => g.entries.length > 0);
        return (
          <>
            <CommandInput placeholder="Jump to a page, repo, or PR…" />
            <CommandList class="max-h-96">
              <Show
                when={visible().length > 0}
                fallback={<div class="py-8 text-center text-sm text-muted-foreground">No matches for “{ctx.search()}”.</div>}
              >
                <For each={visible()}>
                  {(g) => (
                    <CommandGroup heading={g.heading}>
                      <For each={g.entries}>
                        {(e) => (
                          <CommandItem title={e.title} subtitle={e.subtitle} icon={e.icon} shouldFilter={false} onSelect={() => go(e.path)} />
                        )}
                      </For>
                    </CommandGroup>
                  )}
                </For>
              </Show>
            </CommandList>
            <CommandFooter />
          </>
        );
      }}
    </CommandDialog>
  );
}
