"use client";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { AnimatedCircularProgressBar } from "./animated-circular-progress-bar";

/** Magic UI's circular progress bar in the theme's colors; it jumps to its value with reduced motion. */
export function Gauge({ value, max = 100, label, className = "size-20 text-base" }: { value: number; max?: number; label: string; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <div role="img" aria-label={label} data-effect="gauge" className={reduced ? "[&_*]:!transition-none [&_*]:!animate-none" : undefined}>
      <AnimatedCircularProgressBar value={value} max={max} gaugePrimaryColor="var(--primary)" gaugeSecondaryColor="color-mix(in oklab, var(--border) 70%, transparent)" className={className} />
    </div>
  );
}
