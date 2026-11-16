"use client";

import { Banner } from "@astryxdesign/core/Banner";

/** The kit screens need AskWithAI; with a baseline provider they say how to connect it instead of failing. */
export function KitGate({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  if (!ready) return <Banner status="info" title="Connect AskWithAI to see decisions here" description="Set ASKWITHAI_API_KEY and PULLUP_RUNTIME (see docs/adopting-askwithai.md). With PULLUP_DECIDER=jev or gemini and the base address pointed at AskWithAI, decisions are still recorded there." />;
  return <>{children}</>;
}
