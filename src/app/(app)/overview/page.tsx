import { DashboardPanel, PageBody } from "@/components/app-shell/dashboard-panel";
import { AutoRefresh } from "@/components/common/auto-refresh";
import { DotPattern } from "@/components/effects/dot-pattern";
import { NumberTicker } from "@/components/effects/number-ticker";
import { EmptyState } from "@/components/common/empty-state";
import { FirstCouncilPass } from "@/components/runs/first-council-pass";
import { LiveFeed } from "@/components/runs/live-feed";
import { BentoGrid } from "@/components/ui/bento-grid";
import { Button } from "@/components/ui/button";
import { dollars } from "@/lib/format";
import { overview } from "@/server/dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

function Tile({ label, children, hint, className = "" }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-background p-4 ring ring-border ${className}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground tabular-nums">{children}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default async function OverviewPage() {
  const o = await overview();
  return (
    <DashboardPanel title="Overview" actions={<Button href="/runs" color="neutral" variant="ghost" size="sm" trailingIcon="i-lucide-arrow-right">All runs</Button>}>
      <AutoRefresh />
      <FirstCouncilPass repos={o.councilPassRepos} />
      <PageBody>
        {/* A bento of the day's numbers: the counts move when they change; cost never animates. */}
        <div data-testid="overview-tiles">
        <BentoGrid className="relative max-w-none gap-3 sm:grid-cols-2 md:auto-rows-auto md:grid-cols-2 lg:grid-cols-4">
          <DotPattern className="-z-0 text-border [mask-image:radial-gradient(260px_circle_at_top_left,white,transparent)]" />
          <Tile label="Runs in the last 24 hours" className="lg:col-span-2" hint={`${o.repoCount} repositor${o.repoCount === 1 ? "y" : "ies"}`}>
            <NumberTicker value={o.runsToday} />
          </Tile>
          <Tile label="Reached the council" hint="Target: under 15% of runs">
            <NumberTicker value={Math.round(o.councilShare * 100)} />%
          </Tile>
          <Tile label="Waiting for a person" hint={o.waiting ? "See Questions" : "Nothing waiting"}>
            <NumberTicker value={o.waiting} />
          </Tile>
          <Tile label="Council cost, last 24 hours" className="sm:col-span-2 lg:col-span-4" hint="As reported by WithAI">
            {dollars(o.costToday)}
          </Tile>
        </BentoGrid>
        </div>
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Latest runs</h2>
          {o.recent.length ? (
            <LiveFeed runs={o.recent} />
          ) : (
            <EmptyState
              icon="i-lucide-inbox"
              title="No runs yet"
              description="PullUp decides a commit once its required workflows finish. Set up a repository to start."
              action={{ href: "/setup", label: "Set up a repo" }}
            />
          )}
        </section>
      </PageBody>
    </DashboardPanel>
  );
}
