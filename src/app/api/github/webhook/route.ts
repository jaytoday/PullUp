import { verifyWebhookSignature } from "@pullup/github";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { and, eq } from "drizzle-orm";
import { deliveries, runs } from "@/lib/db/schema";
import { noteMerged, noteReverted, revertedPull } from "@/server/outcomes";
import { answerFromGithub, latestRunForPull, liveDeps, noteWorkflowFinished, parsePullupCommand, processRun } from "@/server/pipeline";

/**
 * GitHub App webhook. Only signed deliveries are accepted, each delivery id is
 * handled once, and the work runs after the response so GitHub never times out.
 * Text from pull requests is data: nothing here acts on it except the exact
 * `/pullup pass|fail` command from a listed reviewer or an admin.
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
    const payload = JSON.parse(body) as { action: string; repository: { full_name: string }; workflow_run: { head_sha: string; pull_requests?: { number: number }[] } };
    if (payload.action !== "completed") return NextResponse.json({ ok: true, ignored: payload.action });
    const runId = await noteWorkflowFinished(payload.repository.full_name, payload.workflow_run.head_sha, payload.workflow_run.pull_requests?.[0]?.number ?? null, new Date());
    after(() => processRun(runId, liveDeps()));
    return NextResponse.json({ ok: true, runId }, { status: 202 });
  }

  // The Pass and Fail buttons on the check run.
  if (event === "check_run") {
    const payload = JSON.parse(body) as { action: string; requested_action?: { identifier: string }; check_run: { head_sha: string }; repository: { full_name: string }; sender: { login: string } };
    const value = payload.requested_action?.identifier;
    if (payload.action !== "requested_action" || (value !== "pass" && value !== "fail")) return NextResponse.json({ ok: true, ignored: payload.action });
    const [run] = await db.select().from(runs).where(and(eq(runs.repo, payload.repository.full_name), eq(runs.headSha, payload.check_run.head_sha)));
    if (!run) return NextResponse.json({ ok: true, ignored: "unknown run" });
    after(() => answerFromGithub(run.id, payload.sender.login, value, "", "check-run button", liveDeps()));
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  // `/pullup pass <reason>` or `/pullup fail <reason>` on a pull request.
  if (event === "issue_comment") {
    const payload = JSON.parse(body) as { action: string; comment: { body: string }; issue: { number: number; pull_request?: unknown }; repository: { full_name: string }; sender: { login: string; type?: string } };
    const command = payload.action === "created" && payload.issue.pull_request && payload.sender.type !== "Bot" ? parsePullupCommand(payload.comment.body) : null;
    if (!command) return NextResponse.json({ ok: true, ignored: "not a /pullup command" });
    const run = await latestRunForPull(payload.repository.full_name, payload.issue.number);
    if (!run) return NextResponse.json({ ok: true, ignored: "unknown run" });
    after(() => answerFromGithub(run.id, payload.sender.login, command.value, command.reason, "comment", liveDeps()));
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  // Outcomes: a merge, and a merged revert ("Reverts owner/repo#123").
  if (event === "pull_request") {
    const payload = JSON.parse(body) as { action: string; pull_request: { number: number; merged?: boolean; merged_at?: string | null; body?: string | null }; repository: { full_name: string } };
    if (payload.action !== "closed" || !payload.pull_request.merged) return NextResponse.json({ ok: true, ignored: payload.action });
    const repo = payload.repository.full_name;
    const at = new Date(payload.pull_request.merged_at ?? Date.now());
    await noteMerged(repo, payload.pull_request.number, at);
    const original = revertedPull(payload.pull_request.body ?? "", repo);
    if (original !== null) after(() => noteReverted(repo, original, at, liveDeps()));
    return NextResponse.json({ ok: true }, { status: 202 });
  }
  return NextResponse.json({ ok: true, ignored: event });
}
