import { DashboardPanel, PageBody } from "@/components/app-shell/dashboard-panel";
import { EmptyState } from "@/components/common/empty-state";
import { costPerDay, triggerAccuracy } from "@/server/dashboard";
import { dollars, percent } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accuracy" };

export default async function AccuracyPage() {
  const [accuracy, cost] = await Promise.all([triggerAccuracy(), costPerDay()]);
  const maxCost = Math.max(...cost.map((d) => d.cost), 0.0001);
  return (
    <DashboardPanel title="Accuracy and cost">
      <PageBody>
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">How often the council agreed with the person</h2>
          <p className="text-sm text-muted-foreground">Per trigger, for questions a person answered: the council&apos;s lean (most seats said pass and no fail held up → pass, otherwise fail) against the person&apos;s answer.</p>
          {accuracy.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="accuracy">
              {accuracy.map((a) => (
                <div key={a.trigger} className="rounded-lg bg-background p-4 ring ring-border">
                  <p className="font-mono text-xs text-muted-foreground">{a.trigger}</p>
                  <p className="mt-1 text-3xl font-semibold text-foreground tabular-nums">{percent(a.agreed / a.total)}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.agreed} of {a.total} answers
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="i-lucide-target" title="No answers from people yet" description="Agreement appears once people have answered questions on repos in active mode." />
          )}
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Council cost per day (last 14 days)</h2>
          <div className="rounded-lg bg-background p-4 ring ring-border">
            <div className="flex h-32 items-end gap-1" role="img" aria-label="Council cost per day">
              {cost.map((d) => (
                <div key={d.day} className="flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(2, (d.cost / maxCost) * 100)}%` }} title={`${d.day}: ${dollars(d.cost)}, ${d.calls} calls, ${d.runs} runs`} />
              ))}
            </div>
            <table className="mt-3 w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-start font-normal">Day</th>
                  <th className="text-end font-normal">Runs</th>
                  <th className="text-end font-normal">Council calls</th>
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
