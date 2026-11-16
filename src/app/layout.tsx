import type { Metadata, Viewport } from "next";
import "astryx-themes/fonts.css";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/lab/lab.css";
import "@astryxdesign/charts/charts.css";
import "astryx-themes/cyanotype/theme.css";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: { default: "PullUp: a CI decision agent", template: "%s · PullUp" },
  description: "After CI finishes, PullUp fails real breakage, passes routine changes, and asks its AskWithAI decision runtime, and a person when it matters, about the rest.",
};

export const viewport: Viewport = { colorScheme: "dark", themeColor: "#080a0c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
