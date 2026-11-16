import { notFound } from "next/navigation";
import { RunDetail } from "@/components/runs/run-detail";
import { connectionStatus } from "@/server/connection";
import { getRun } from "@/server/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  const status = await connectionStatus();
  return <RunDetail run={run} runtime={status.kitReady ? status.runtime : null} />;
}
