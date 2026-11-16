import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assessments } from "@/lib/db/schema";
import { harnessOf } from "./agent";
import { deciderOf } from "./decide";
import { runtimeRef } from "./decide/askwithai";
import { isDemo } from "./demo";

/** What the settings page shows about the decision provider: which one, where, and when it last answered. Never the key. */
export async function connectionStatus(env: Record<string, string | undefined> = process.env) {
  const decider = deciderOf(env);
  const [last] = await db.select({ at: assessments.updatedAt, provider: assessments.provider, status: assessments.status }).from(assessments).orderBy(desc(assessments.updatedAt)).limit(1);
  const baseUrl = decider === "jev" ? (env.JEV_BASE_URL ?? "https://api.typesafe.ai") : decider === "gemini" ? (env.GEMINI_DECISIONS_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta") : (env.ASKWITHAI_URL ?? "https://api.askwith.ai");
  const keySet = decider === "jev" ? !!env.JEV_API_KEY : decider === "gemini" ? !!env.GEMINI_API_KEY : !!env.ASKWITHAI_API_KEY;
  return {
    decider,
    baseUrl,
    viaAskWithAI: decider === "askwithai" || /\/v1\/runtimes\//.test(baseUrl),
    runtime: runtimeRef(env) || null,
    keySet,
    kitReady: !!env.ASKWITHAI_API_KEY && !!runtimeRef(env),
    harness: harnessOf(env),
    demo: isDemo(env),
    lastCall: last ? { at: last.at.toISOString(), provider: last.provider, status: last.status } : null,
  };
}
export type ConnectionStatus = Awaited<ReturnType<typeof connectionStatus>>;
