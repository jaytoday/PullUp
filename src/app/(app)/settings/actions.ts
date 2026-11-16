"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";

/** Switch a repository between Report only and Enforce. Signed-in users only. */
export async function setCheckMode(repo: string, mode: "report_only" | "enforce") {
  if (!(await auth.api.getSession({ headers: await headers() }))) throw new Error("Sign in first.");
  if (mode !== "report_only" && mode !== "enforce") throw new Error("Unknown mode.");
  await db.update(repos).set({ checkMode: mode }).where(eq(repos.fullName, repo));
  revalidatePath("/settings");
}
