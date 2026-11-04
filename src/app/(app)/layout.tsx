import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { db } from "@/lib/db/client";
import { asks } from "@/lib/db/schema";
import { isStopped } from "@/server/stores";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const open = (await db.select({ id: asks.runId }).from(asks).where(eq(asks.open, true))).length;
  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh">
      <AppSidebar openQuestions={open} stopped={await isStopped()} />
      <SidebarInset className="min-h-0 overflow-hidden bg-muted ring ring-border md:peer-data-[variant=inset]:shadow-sm">{children}</SidebarInset>
    </SidebarProvider>
  );
}
