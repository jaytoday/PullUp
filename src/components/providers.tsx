"use client";

import Link from "next/link";
import { LinkProvider } from "@astryxdesign/core/Link";
import { Theme } from "@astryxdesign/core/theme";
import { cyanotypeTheme } from "astryx-themes/cyanotype";
import { AskWithAIProvider } from "@askwithai/react";

/** Astryx with the Cyanotype theme, and the AskWithAI web kit talking to PullUp's own route (the key stays on the server). */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Theme theme={cyanotypeTheme} mode="dark">
      <LinkProvider component={Link}>
        <AskWithAIProvider endpoint="/api/askwithai">{children}</AskWithAIProvider>
      </LinkProvider>
    </Theme>
  );
}
