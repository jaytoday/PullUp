import { DashboardPanel, PageBody } from "@/components/app-shell/dashboard-panel";
import { EmptyState } from "@/components/common/empty-state";
import { RepoMode } from "@/components/settings/repo-mode";
import { StopSwitch } from "@/components/settings/stop-switch";
import { configOf, repoList } from "@/server/dashboard";
import { getSetting } from "@/server/stores";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [repos, stopped] = await Promise.all([repoList(), getSetting("stopped", false)]);
  const forced = process.env.PULLUP_STOP === "1";
  return (
    <DashboardPanel title="Settings">
      <PageBody className="max-w-3xl">
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Repositories</h2>
          <p className="text-sm text-muted-foreground">Every repository starts in shadow mode: PullUp posts a neutral check with what it would decide. The rules themselves live in each repository&apos;s <code className="font-mono">.pullup/config.json</code> on its default branch (see Set up a repo).</p>
          {repos.length ? (
            <div className="divide-y overflow-hidden rounded-lg bg-background ring ring-border">
              {repos.map((r) => (
                <div key={r.fullName}>
                  <RepoMode repo={r.fullName} mode={r.mode} />
                  {r.latest && configOf(r.latest) ? (
                    <details className="px-4 pb-3 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Config used for the latest run</summary>
                      <pre className="mt-2 overflow-x-auto rounded bg-elevated p-3 font-mono text-body">{JSON.stringify(configOf(r.latest), null, 2)}</pre>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="i-lucide-git-branch" title="No repositories yet" description="A repository appears here after its first workflow run reaches PullUp." action={{ href: "/setup", label: "Set up a repo" }} />
          )}
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Safety</h2>
          <div className="overflow-hidden rounded-lg bg-background ring ring-border">
            <StopSwitch stopped={stopped || forced} forcedByEnv={forced} />
          </div>
        </section>
      </PageBody>
    </DashboardPanel>
  );
}
