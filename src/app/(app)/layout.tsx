import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PullUpShell } from "@/components/shell/app-shell";
import { isDemo } from "@/server/demo";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return (
    <PullUpShell email={session.user.email} demo={isDemo()}>
      {children}
    </PullUpShell>
  );
}
