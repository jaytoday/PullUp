"use client";

import dynamic from "next/dynamic";
import { DotPattern } from "@/components/effects/dot-pattern";
import { useThemeColor } from "@/components/effects/theme-color";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

// WebGL, so loaded only in the browser.
const DotGrid = dynamic(() => import("@/components/effects/dot-grid"), { ssr: false });

/**
 * The landing hero's one heavy effect: React Bits' DotGrid (WebGL; it pauses off
 * screen and in hidden tabs), lit in the theme's primary color near the pointer.
 * Still dots (a plain CSS pattern) with reduced motion or before WebGL loads.
 * Place inside a `relative isolate` parent.
 */
export function HeroBackdrop() {
  const reduced = useReducedMotion();
  const base = useThemeColor("--border");
  const active = useThemeColor("--primary");
  const mask = "mask-[radial-gradient(ellipse_at_center,white,transparent_70%)]";
  if (reduced || !base || !active) return <DotPattern className={`-z-10 text-border ${mask}`} />;
  return (
    <div aria-hidden data-effect="dot-grid" className={`pointer-events-none absolute inset-0 -z-10 opacity-70 ${mask}`}>
      <DotGrid dotSize={4} gap={22} baseColor={base} activeColor={active} proximity={140} clickShock={false} />
    </div>
  );
}
