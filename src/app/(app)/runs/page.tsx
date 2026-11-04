import { DashboardPanel, PageBody } from "@/components/app-shell/dashboard-panel";
import { AutoRefresh } from "@/components/common/auto-refresh";
import { EmptyState } from "@/components/common/empty-state";
import { RunList } from "@/components/runs/run-list";
import { listRuns, repoList } from "@/server/dashboard";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Runs" };

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ repo?: string; pull?: string }> }) {
  const { repo, pull } = await searchParams;
  const [runs, repos] = await Promise.all([listRuns({ repo, pull: pull ? Number(pull) : undefined }), repoList()]);
  const chip = (href: string, label: string, on: boolean) => (
    <Link key={href} href={href} className={`rounded-full px-3 py-1 text-xs ring ring-border ${on ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-body hover:bg-elevated"}`}>
      {label}
    </Link>
  );
  return (
    <DashboardPanel title="Runs">
      <AutoRefresh />
      <PageBody>
        <nav className="flex flex-wrap gap-2" aria-label="Filter by repository">
          {chip("/runs", "All repositories", !repo)}
          {repos.map((r) => chip(`/runs?repo=${encodeURIComponent(r.fullName)}`, r.fullName, repo === r.fullName))}
          {pull && repo ? chip(`/runs?repo=${encodeURIComponent(repo)}&pull=${pull}`, `#${pull}`, true) : null}
        </nav>
        {runs.length ? <RunList runs={runs} /> : <EmptyState icon="i-lucide-list-checks" title="No runs here" description="Runs appear when a required workflow finishes on a pull request." action={{ href: "/setup", label: "Set up a repo" }} />}
      </PageBody>
    </DashboardPanel>
  );
}
