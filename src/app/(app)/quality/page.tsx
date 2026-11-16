import { QualityScreen } from "@/components/kit/kit-pages";
import { Heading } from "@/components/kit/server-safe";
import { DemoControls } from "@/components/quality/demo-controls";
import { RunCounts } from "@/components/quality/run-counts";
import { connectionStatus } from "@/server/connection";
import { runCounts } from "@/server/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quality" };

export default async function QualityPage() {
  const s = await connectionStatus();
  const showDemo = s.demo || process.env.NODE_ENV === "development";
  return (
    <>
      <Heading title="Quality" description="How good and how cheap the decisions are, from AskWithAI, and the serving mode: parity (the provider's own answer), shadow (also record what routing would answer) or active (routed answers)." />
      <div style={{ display: "grid", gap: 20 }}>
        {showDemo && s.demo && <DemoControls />}
        <RunCounts c={await runCounts()} />
        <QualityScreen runtime={s.kitReady ? s.runtime : null} />
      </div>
    </>
  );
}
