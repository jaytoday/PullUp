import { DashboardPanel, PageBody } from "@/components/app-shell/dashboard-panel";
import { EmptyState } from "@/components/common/empty-state";
import { RepoMode } from "@/components/settings/repo-mode";
import { ExtensionsEditor } from "@/components/settings/extensions/extensions-editor";
import { StopSwitch } from "@/components/settings/stop-switch";
import { configOf, repoList } from "@/server/dashboard";
import { extensionsEditor } from "@/server/extensions";
import { threatDrift } from "@/server/threat-drift";
import { getSetting } from "@/server/stores";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [repos, stopped] = await Promise.all([repoList(), getSetting("stopped", false)]);
  const editors = await Promise.all(repos.map((r) => extensionsEditor(r.fullName)));
  const drifts = await Promise.all(repos.map((r) => threatDrift(r.fullName)));
  const forced = process.env.PULLUP_STOP === "1";
  return (
    <DashboardPanel title="Settings">
      <PageBody className="max-w-3xl">
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Repositories</h2>
          <p className="text-sm text-muted-foreground">Every repository starts in shadow mode: PullUp posts a neutral check with what it would decide. The rules themselves live in each repository&apos;s <code className="font-mono">.pullup/config.json</code> on its default branch (see Set up a repo).</p>
          {repos.length ? (
            <div className="divide-y overflow-hidden rounded-lg bg-background ring ring-border">
              {repos.map((r, i) => (
                <div key={r.fullName}>
                  <RepoMode repo={r.fullName} mode={r.mode} />
                  <section className="space-y-2 px-4 pb-3" aria-label={`${r.fullName} extensions`}>
                    <h3 className="text-xs font-medium text-muted-foreground">Extensions</h3>
                    {drifts[i] ? (
                      <div className={drifts[i]!.problems.length ? "rounded-md bg-warning/10 p-3 text-sm" : "text-xs text-muted-foreground"} data-testid={`threat-drift-${r.fullName}`}>
                        {drifts[i]!.problems.length ? (
                          <>
                            <p className="font-medium text-foreground">
                              The threat model ({drifts[i]!.path}) on the default branch has {drifts[i]!.problems.length} problem{drifts[i]!.problems.length > 1 ? "s" : ""}:
                            </p>
                            <ul className="list-disc ps-5 text-body">
                              {drifts[i]!.problems.slice(0, 8).map((p) => (
                                <li key={p}>{p}</li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p>Threat model ({drifts[i]!.path}) checked on the default branch: its code map matches the code.</p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">Checked {new Date(drifts[i]!.checkedAt).toLocaleString()} (once a day).</p>
                      </div>
                    ) : null}
                    {editors[i]!.committed ? (
                      <ExtensionsEditor repo={r.fullName} extensions={editors[i]!.extensions} committed={editors[i]!.committed!} draft={editors[i]!.draft} />
                    ) : (
                      <p className="text-xs text-muted-foreground">PullUp shows this repository&apos;s extensions after it reads its config on the first run.</p>
                    )}
                  </section>
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
