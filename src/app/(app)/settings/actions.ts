"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { discardDraft, saveDraft } from "@/server/extensions";
import { setSetting } from "@/server/stores";

async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Sign in first.");
  return session.user;
}

/** Shadow (record only) or active (pass, fail and ask people). Going active needs the repo name typed back. */
export async function setRepoMode(repo: string, mode: "shadow" | "active", confirmation: string) {
  await requireUser();
  if (mode === "active" && confirmation.trim() !== repo) throw new Error(`Type ${repo} to confirm.`);
  await db.update(repos).set({ mode }).where(eq(repos.fullName, repo));
  revalidatePath("/settings");
}

/** The stop switch: while on, PullUp posts nothing to GitHub. */
export async function setStopped(stopped: boolean) {
  await requireUser();
  await setSetting("stopped", stopped);
  revalidatePath("/", "layout");
}

/** Save a draft of the repository's config with new extension settings (see server/extensions.ts). */
export async function saveExtensionsDraft(repo: string, extensions: Record<string, Record<string, unknown>>, confirmation: string) {
  await requireUser();
  try {
    const saved = await saveDraft(repo, extensions, confirmation);
    revalidatePath("/settings");
    return { ok: true as const, ...saved };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message.split("\n")[0]!.slice(0, 500) };
  }
}

export async function discardExtensionsDraft(repo: string) {
  await requireUser();
  await discardDraft(repo);
  revalidatePath("/settings");
}
