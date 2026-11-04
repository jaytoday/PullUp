import { verifyWebhookSignature } from "@pullup/github";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { deliveries } from "@/lib/db/schema";
import { liveDeps, noteWorkflowFinished, processRun } from "@/server/pipeline";

/**
 * GitHub App webhook. Only signed deliveries are accepted, each delivery id is
 * handled once, and the work runs after the response so GitHub never times out.
 * Payload text from pull requests is data: nothing here acts on it.
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (!verifyWebhookSignature(process.env.GITHUB_WEBHOOK_SECRET?.trim() ?? "", body, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const event = request.headers.get("x-github-event") ?? "";
  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  if (!deliveryId) return NextResponse.json({ error: "no delivery id" }, { status: 400 });
  const fresh = await db.insert(deliveries).values({ id: deliveryId, event, receivedAt: new Date() }).onConflictDoNothing().returning();
  if (!fresh.length) return NextResponse.json({ ok: true, duplicate: true });

  if (event === "workflow_run") {
    const payload = JSON.parse(body) as {
      action: string;
      repository: { full_name: string };
      workflow_run: { head_sha: string; pull_requests?: { number: number }[] };
    };
    if (payload.action !== "completed") return NextResponse.json({ ok: true, ignored: payload.action });
    const runId = await noteWorkflowFinished(payload.repository.full_name, payload.workflow_run.head_sha, payload.workflow_run.pull_requests?.[0]?.number ?? null, new Date());
    after(() => processRun(runId, liveDeps()));
    return NextResponse.json({ ok: true, runId }, { status: 202 });
  }
  return NextResponse.json({ ok: true, ignored: event });
}
