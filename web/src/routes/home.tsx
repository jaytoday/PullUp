import { Navigate, useNavigate } from "@solidjs/router";
import { createSignal, For, Match, Switch } from "solid-js";
import { Database } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyIcon, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { showToast } from "@/components/ui/toast";
import { useApp } from "@/components/layout/app-context";
import { PageSkeleton } from "@/components/layout/repo-layout";
import { Logo } from "@/components/layout/logo";
import { api } from "@/lib/api";

const FIXTURE_HINTS: Record<string, string> = {
  jev: "45 PRs incl. 5 hand-built scenarios for every Jev band",
  healthy: "120 PRs, reviews land in 4–48h",
  congested: "120 PRs, reviews land in 1–7 days",
  calibration: "600 PRs of labelled history for calibration",
};

/** Redirects to the first repo; with none ingested, offers the bundled fixtures (dev). */
export default function Home() {
  const { repos, config, refetchRepos } = useApp();
  const navigate = useNavigate();
  const [loading, setLoading] = createSignal<string | null>(null);

  const load = async (fixture: string) => {
    setLoading(fixture);
    try {
      const r = await api.ingest(fixture);
      showToast({ title: `Ingested fixtures/${fixture}`, description: `${r.pulls} PRs · ${r.reviews} reviews`, variant: "success" });
      refetchRepos();
      navigate(`/r/fixtures/${fixture}`);
    } catch (err) {
      showToast({ title: "Ingest failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  };

  return (
    <Switch fallback={<div class="p-6"><PageSkeleton /></div>}>
      <Match when={repos() && repos()!.length > 0}>
        <Navigate href={`/r/${repos()![0]!.repoId}`} />
      </Match>
      <Match when={repos()}>
        <main class="flex flex-1 items-center justify-center p-6">
          <div class="w-full max-w-2xl space-y-8">
            <Logo class="scale-125" />
            <Empty class="border-border bg-card/50">
              <EmptyIcon>
                <Database />
              </EmptyIcon>
              <EmptyTitle>No repositories ingested yet</EmptyTitle>
              <EmptyDescription>
                Ingest a repo with <code class="num text-foreground">pullup fetch owner/repo</code>, or load a bundled fixture to explore.
              </EmptyDescription>
            </Empty>
            <div class="grid gap-3 sm:grid-cols-2">
              <For each={config()?.fixtures ?? []}>
                {(f) => (
                  <Button variant="outline" class="h-auto flex-col items-start gap-1 p-4 text-left" disabled={loading() !== null} onClick={() => void load(f)}>
                    <span class="flex items-center gap-2 font-medium">
                      {loading() === f && <Spinner size="sm" />}
                      fixtures/{f}
                    </span>
                    <span class="whitespace-normal text-xs font-normal text-muted-foreground">{FIXTURE_HINTS[f] ?? "Bundled fixture"}</span>
                  </Button>
                )}
              </For>
            </div>
          </div>
        </main>
      </Match>
    </Switch>
  );
}
