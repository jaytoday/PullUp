// From Magic UI (MIT license), "animated-beam". Changed: theme colors by default; with reduced motion
// only the still line is drawn.
"use client";

import { motion } from "motion/react";
import { type RefObject, useEffect, useId, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

export interface AnimatedBeamProps {
  className?: string;
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  curvature?: number;
  reverse?: boolean;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  gradientStartColor?: string;
  gradientStopColor?: string;
  delay?: number;
  duration?: number;
  startXOffset?: number;
  startYOffset?: number;
  endXOffset?: number;
  endYOffset?: number;
}

/**
 * A line between two elements inside `containerRef` with a light travelling along it, showing that
 * one part feeds the next. The container needs `position: relative`.
 */
export function AnimatedBeam({
  className,
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  reverse = false,
  duration = 5,
  delay = 0,
  pathColor = "var(--muted-foreground)",
  pathWidth = 2,
  pathOpacity = 0.2,
  gradientStartColor = "var(--primary)",
  gradientStopColor = "color-mix(in oklab, var(--primary) 60%, var(--foreground))",
  startXOffset = 0,
  startYOffset = 0,
  endXOffset = 0,
  endYOffset = 0,
}: AnimatedBeamProps) {
  const id = useId();
  const reduced = useReducedMotion();
  const [pathD, setPathD] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const coordinates = reverse
    ? { x1: ["90%", "-10%"], x2: ["100%", "0%"], y1: ["0%", "0%"], y2: ["0%", "0%"] }
    : { x1: ["10%", "110%"], x2: ["0%", "100%"], y1: ["0%", "0%"], y2: ["0%", "0%"] };

  useEffect(() => {
    const updatePath = () => {
      if (!containerRef.current || !fromRef.current || !toRef.current) return;
      const box = containerRef.current.getBoundingClientRect();
      const a = fromRef.current.getBoundingClientRect();
      const b = toRef.current.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
      const startX = a.left - box.left + a.width / 2 + startXOffset;
      const startY = a.top - box.top + a.height / 2 + startYOffset;
      const endX = b.left - box.left + b.width / 2 + endXOffset;
      const endY = b.top - box.top + b.height / 2 + endYOffset;
      setPathD(`M ${startX},${startY} Q ${(startX + endX) / 2},${startY - curvature} ${endX},${endY}`);
    };
    const observer = new ResizeObserver(updatePath);
    if (containerRef.current) observer.observe(containerRef.current);
    updatePath();
    return () => observer.disconnect();
  }, [containerRef, fromRef, toRef, curvature, startXOffset, startYOffset, endXOffset, endYOffset]);

  return (
    <svg
      aria-hidden
      data-effect="animated-beam"
      fill="none"
      width={size.width}
      height={size.height}
      className={cn("pointer-events-none absolute top-0 left-0 transform-gpu", className)}
      viewBox={`0 0 ${size.width} ${size.height}`}
    >
      <path d={pathD} stroke={pathColor} strokeWidth={pathWidth} strokeOpacity={pathOpacity} strokeLinecap="round" />
      {reduced ? null : (
        <>
          <path d={pathD} strokeWidth={pathWidth} stroke={`url(#${id})`} strokeOpacity="1" strokeLinecap="round" />
          <defs>
            <motion.linearGradient
              id={id}
              gradientUnits="userSpaceOnUse"
              initial={{ x1: "0%", x2: "0%", y1: "0%", y2: "0%" }}
              animate={coordinates}
              transition={{ delay, duration, ease: [0.16, 1, 0.3, 1], repeat: Number.POSITIVE_INFINITY }}
            >
              <stop stopColor={gradientStartColor} stopOpacity="0" />
              <stop stopColor={gradientStartColor} />
              <stop offset="32.5%" stopColor={gradientStopColor} />
              <stop offset="100%" stopColor={gradientStopColor} stopOpacity="0" />
            </motion.linearGradient>
          </defs>
        </>
      )}
    </svg>
  );
}
