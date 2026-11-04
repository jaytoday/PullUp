"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
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
