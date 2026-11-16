import { Heading } from "@/components/kit/server-safe";
import { RunsTable } from "@/components/runs/runs-table";
import { listRuns } from "@/server/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Runs" };

export default async function RunsPage() {
  const runs = await listRuns();
  return (
    <>
      <Heading title="Runs" description="One run per commit after its CI finished: what PullUp decided, from which concerns, and what it cost." />
      <RunsTable runs={runs} />
    </>
  );
}
