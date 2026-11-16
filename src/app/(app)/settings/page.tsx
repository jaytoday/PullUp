import { Heading } from "@/components/kit/server-safe";
import { SettingsView } from "@/components/settings/settings-view";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { connectionStatus } from "@/server/connection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const list = await db.select().from(repos);
  return (
    <>
      <Heading title="Settings" />
      <SettingsView status={await connectionStatus()} repos={list.map((r) => ({ fullName: r.fullName, checkMode: r.checkMode, synthetic: r.synthetic }))} />
    </>
  );
}
