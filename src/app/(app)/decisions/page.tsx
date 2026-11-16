import { DecisionsScreen } from "@/components/kit/kit-pages";
import { Heading } from "@/components/kit/server-safe";
import { connectionStatus } from "@/server/connection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Decisions" };

export default async function DecisionsPage() {
  const s = await connectionStatus();
  return (
    <>
      <Heading title="Decisions" description="Every merge-risk decision PullUp asked for, with its receipt: who answered, why, how sure, and what it cost. Open one to report what really happened." />
      <DecisionsScreen runtime={s.kitReady ? s.runtime : null} />
    </>
  );
}
