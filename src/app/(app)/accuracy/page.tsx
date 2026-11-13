import { DashboardPanel, PageBody } from "@/components/app-shell/dashboard-panel";
import { AgreementTile } from "@/components/accuracy/agreement-tile";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { costPerDay, questionAccuracy, shadowOutcomes } from "@/server/dashboard";
import { dollars } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accuracy" };

export default async function AccuracyPage({ searchParams }: { searchParams: Promise<{ extension?: string }> }) {
  const { extension } = await searchParams;
  const [all, cost, shadow] = await Promise.all([questionAccuracy(), costPerDay(), shadowOutcomes()]);
  const extensions = [...new Set(all.map((a) => a.id.split(":")[0]!))].sort();
  const accuracy = extension ? all.filter((a) => a.id.startsWith(`${extension}:`)) : all;
  const maxCost = Math.max(...cost.map((d) => d.cost), 0.0001);
  return (
    <DashboardPanel title="Accuracy and cost">
      <PageBody>
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">How often model decisions matched the person</h2>
          <p className="text-sm text-muted-foreground">Per kind of question, compares the recorded runtime answer (or the older council result) with real pass or fail rulings from people.</p>
          {extensions.length > 1 ? (
            <nav className="flex flex-wrap gap-1" aria-label="Filter by extension">
              <Button href="/accuracy" size="xs" color="neutral" variant={extension ? "ghost" : "soft"}>
                All
              </Button>
              {extensions.map((e) => (
                <Button key={e} href={`/accuracy?extension=${encodeURIComponent(e)}`} size="xs" color="neutral" variant={extension === e ? "soft" : "ghost"}>
                  {e}
                </Button>
              ))}
            </nav>
          ) : null}
          {accuracy.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="accuracy">
              {accuracy.map((a) => (
                <AgreementTile key={a.id} {...a} />
              ))}
            </div>
          ) : (
            <EmptyState icon="i-lucide-target" title="No answers from people yet" description="Agreement appears once people have answered questions on repos in active mode." />
          )}
        </section>
        {shadow.length ? (
          <section className="space-y-2" data-testid="shadow-outcomes">
            <h2 className="text-sm font-medium text-foreground">Extensions in Shadow mode</h2>
            <p className="text-sm text-muted-foreground">What PullUp and its configured AskWithAI runtime decided for Shadow questions. No one is asked about them; use these comparisons before allowing runtime answers to affect Active checks.</p>
            <table className="w-full rounded-lg bg-background text-sm ring ring-border">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-normal">Extension</th>
                  <th className="px-3 py-2 text-end font-normal">Would pass</th>
                  <th className="px-3 py-2 text-end font-normal">Would fail</th>
                  <th className="px-3 py-2 text-end font-normal">Would ask a person</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {shadow.map((r) => (
                  <tr key={r.extension} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{r.extension}</td>
                    <td className="px-3 py-2 text-end">{r.pass}</td>
                    <td className="px-3 py-2 text-end">{r.fail}</td>
                    <td className="px-3 py-2 text-end">{r.ask}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Decision cost per day (last 14 days)</h2>
          <div className="rounded-lg bg-background p-4 ring ring-border">
            <div className="flex h-32 items-end gap-1" role="img" aria-label="Decision cost per day">
              {cost.map((d) => (
                <div key={d.day} className="flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(2, (d.cost / maxCost) * 100)}%` }} title={`${d.day}: ${dollars(d.cost)}, ${d.calls} calls, ${d.runs} runs`} />
              ))}
            </div>
            <table className="mt-3 w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-start font-normal">Day</th>
                  <th className="text-end font-normal">Runs</th>
                  <th className="text-end font-normal">Decision calls</th>
                  <th className="text-end font-normal">Cost</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {cost.filter((d) => d.runs).map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td className="text-end">{d.runs}</td>
                    <td className="text-end">{d.calls}</td>
                    <td className="text-end">{dollars(d.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </PageBody>
    </DashboardPanel>
  );
}
