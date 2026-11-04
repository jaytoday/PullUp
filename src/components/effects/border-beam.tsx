// From Magic UI (MIT license), "border-beam". Changed: theme colors by default; hidden with reduced motion.
"use client";

import { type MotionStyle, motion } from "motion/react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

interface BorderBeamProps {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  className?: string;
  reverse?: boolean;
  borderWidth?: number;
}

/**
 * A short bright line that travels around its parent's border, meaning "this is running".
 * The parent needs `position: relative` (and usually `overflow-hidden` is not needed).
 */
export function BorderBeam({
  className,
  size = 60,
  delay = 0,
  duration = 6,
  colorFrom = "var(--primary)",
  colorTo = "color-mix(in oklab, var(--primary) 40%, transparent)",
  reverse = false,
  borderWidth = 1,
}: BorderBeamProps) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <div
      aria-hidden
      data-effect="border-beam"
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
      style={{ "--border-beam-width": `${borderWidth}px` } as React.CSSProperties}
    >
      <motion.div
        className={cn("absolute aspect-square bg-linear-to-l from-(--color-from) via-(--color-to) to-transparent", className)}
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            "--color-from": colorFrom,
            "--color-to": colorTo,
          } as MotionStyle
        }
        initial={{ offsetDistance: "0%" }}
        animate={{ offsetDistance: reverse ? ["100%", "0%"] : ["0%", "100%"] }}
        transition={{ repeat: Number.POSITIVE_INFINITY, ease: "linear", duration, delay: -delay }}
      />
    </div>
  );
}
