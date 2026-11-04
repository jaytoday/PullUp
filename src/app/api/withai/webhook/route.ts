import { verifyWebhookSignature } from "@withai/client";
import { after, NextResponse } from "next/server";
import { answerFromWithai, liveDeps } from "@/server/pipeline";

/**
 * WithAI's webhook: a person answered a question PullUp asked. The worker also
 * polls WithAI, so a lost webhook only delays the answer.
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (!(await verifyWebhookSignature(process.env.WITHAI_WEBHOOK_SECRET?.trim() ?? "", body, request.headers.get("withai-signature")))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const event = JSON.parse(body) as { type: string; questionId?: string; data?: { answer?: { optionId?: string; text?: string } | null } };
  const value = event.data?.answer?.optionId;
  if (event.type !== "question.answered" || !event.questionId || (value !== "pass" && value !== "fail")) return NextResponse.json({ ok: true, ignored: event.type });
  const questionId = event.questionId;
  after(() => answerFromWithai(questionId, value, event.data?.answer?.text ?? "", liveDeps()));
  return NextResponse.json({ ok: true }, { status: 202 });
}
