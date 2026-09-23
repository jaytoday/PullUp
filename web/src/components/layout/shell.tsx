import { A, useLocation } from "@solidjs/router";
import { For, Show, type Component, type ParentComponent } from "solid-js";
import {
  BarChart3,
  FlaskConical,
  GitPullRequest,
  History,
  LayoutGrid,
  Settings,
  Search,
} from "lucide-solid";
import { Dynamic } from "solid-js/web";
import { Kbd } from "@/components/ui/kbd";
import { ToastList, ToastRegion } from "@/components/ui/toast";
import { Dot } from "@/components/shared/badges";
import { cn } from "@/lib/cn";
import { useActiveRepo, useMode, withMode } from "@/lib/state";
import { useApp } from "./app-context";
import { CommandPalette, openPalette } from "./command-palette";
import { Logo } from "./logo";

const NAV = [
  { path: "", label: "Overview", icon: LayoutGrid },
  { path: "/pulls", label: "PR queue", icon: GitPullRequest },
  { path: "/actions", label: "Review actions", icon: History },
  { path: "/calibration", label: "Calibration", icon: FlaskConical },
  { path: "/analytics", label: "Analytics", icon: BarChart3 },
] as const;

function NavLink(props: { href: string; active: boolean; icon: Component<{ class?: string }>; label: string; count?: number }) {
  return (
    <A
      href={props.href}
      class={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        props.active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
      aria-current={props.active ? "page" : undefined}
    >
      <Dynamic component={props.icon} class={cn("size-4", props.active ? "text-primary" : "")} />
      <span class="flex-1">{props.label}</span>
      <Show when={props.count !== undefined}>
        <span class="num text-xs text-muted-foreground">{props.count}</span>
      </Show>
    </A>
  );
}

export const Shell: ParentComponent = (props) => {
  const location = useLocation();
  const { config, repos } = useApp();
  const activeRepo = useActiveRepo();
  const [mode] = useMode();
  const repoBase = () => `/r/${activeRepo()}`;
  const isActive = (path: string) => {
    const target = repoBase() + path;
    return path === "" ? location.pathname === target || location.pathname === `${target}/` : location.pathname.startsWith(target);
  };
  const openCount = () => repos()?.find((r) => r.repoId === activeRepo())?.open;

  return (
    <div class="flex min-h-screen bg-background text-foreground">
      <div class="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
      <aside class="sticky top-0 flex h-screen flex-col">
        <div class="flex h-14 items-center px-4">
          <A href="/" aria-label="PullUp home">
            <Logo />
          </A>
        </div>

        <div class="px-3 pb-3">
          <button
            type="button"
            onClick={openPalette}
            class="flex w-full items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Search class="size-3.5" />
            <span class="flex-1 text-left">Jump to…</span>
            <Kbd size="sm">⌘K</Kbd>
          </button>
        </div>

        <nav class="flex-1 space-y-5 overflow-y-auto px-3" aria-label="Main">
          <Show when={activeRepo()}>
            <div class="space-y-0.5">
              <For each={NAV}>
                {(item) => (
                  <NavLink
                    href={withMode(repoBase() + item.path, mode())}
                    active={isActive(item.path)}
                    icon={item.icon}
                    label={item.label}
                    count={item.path === "/pulls" ? openCount() : undefined}
                  />
                )}
              </For>
            </div>
          </Show>

          <div class="space-y-1">
            <div class="px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Repositories</div>
            <For each={repos() ?? []} fallback={<div class="px-2.5 py-1 text-xs text-muted-foreground">None ingested</div>}>
              {(r) => (
                <A
                  href={withMode(`/r/${r.repoId}`, mode())}
                  class={cn(
                    "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    activeRepo() === r.repoId ? "text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <span class="flex min-w-0 items-center gap-2">
                    <span class={cn("size-1.5 shrink-0 rounded-full", activeRepo() === r.repoId ? "bg-primary" : "bg-border")} />
                    <span class="truncate">{r.repoId}</span>
                  </span>
                  <span class="num text-xs text-muted-foreground">{r.open}</span>
                </A>
              )}
            </For>
          </div>
        </nav>

        <div class="space-y-2 border-t border-sidebar-border p-3">
          <NavLink href={withMode("/settings", mode())} active={location.pathname === "/settings"} icon={Settings} label="Settings" />
          <Show when={config()}>
            {(c) => (
              <div class="flex items-center justify-between rounded-md bg-background/50 px-2.5 py-2">
                <Dot
                  class={c().env.signalModel === "jev" ? "bg-band-fast" : "bg-band-review"}
                  label={c().env.signalModel === "jev" ? "Live Jev" : "Synthetic signals"}
                  pulse={c().env.signalModel === "jev"}
                />
                <span class="num text-[11px] text-muted-foreground">{c().env.signalModelId}</span>
              </div>
            )}
          </Show>
        </div>
      </aside>
      </div>

      <div class="flex min-w-0 flex-1 flex-col">{props.children}</div>

      <CommandPalette />
      <ToastRegion>
        <ToastList />
      </ToastRegion>
    </div>
  );
};
