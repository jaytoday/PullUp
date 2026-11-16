import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { appDeps, isDemo, playBatch, reportDemoOutcomes, resetDemo } from "@/server/demo";
import { refreshWaiting } from "@/server/pipeline";

/** Demo controls (only with PULLUP_DEMO=1, only for a signed-in user): play a batch, check waiting runs now, report synthetic outcomes, or start over. */
export async function POST(request: Request) {
  if (!isDemo()) return NextResponse.json({ error: { code: "not_demo", message: "Demo controls work only with PULLUP_DEMO=1." } }, { status: 404 });
  if (!(await auth.api.getSession({ headers: await headers() }))) return NextResponse.json({ error: { code: "unauthorized", message: "Sign in first." } }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { action?: string; size?: number; split?: string };
  const split = body.split === "hard" ? "hard" : undefined;
  if (body.action === "play") return NextResponse.json(await playBatch(Math.min(Math.max(Number(body.size) || 10, 1), 100), appDeps(), split));
  if (body.action === "refresh") return NextResponse.json({ changed: await refreshWaiting(appDeps()) });
  if (body.action === "outcomes") return NextResponse.json(await reportDemoOutcomes());
  if (body.action === "reset") return NextResponse.json(await resetDemo());
  return NextResponse.json({ error: { code: "bad_action", message: "action must be play, refresh, outcomes or reset." } }, { status: 400 });
}
