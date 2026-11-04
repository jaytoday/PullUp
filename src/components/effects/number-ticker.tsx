// From Magic UI (MIT license), "number-ticker". Changed: shows the final value at once with reduced
// motion, re-animates from the previous value when the value changes, and accepts a formatter.
"use client";

import { useInView, useMotionValue, useSpring } from "motion/react";
import { type ComponentPropsWithoutRef, useEffect, useRef } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

interface NumberTickerProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  value: number;
  startValue?: number;
  delay?: number;
  decimalPlaces?: number;
}

function format(value: number, decimalPlaces: number) {
  return Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(Number(value.toFixed(decimalPlaces)));
}

/** A number that counts up to its value when it first scrolls into view, and to each new value after. */
export function NumberTicker({ value, startValue = 0, delay = 0, className, decimalPlaces = 0, ...props }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const motionValue = useMotionValue(startValue);
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 });
  const isInView = useInView(ref, { once: true, margin: "0px" });

  // With reduced motion the spring is ignored and the text is written directly.
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    if (reduced) {
      if (ref.current) ref.current.textContent = format(value, decimalPlaces);
      motionValue.jump(value);
      springValue.jump(value);
      return;
    }
    if (!isInView) return;
    const timer = setTimeout(() => motionValue.set(value), delay * 1000);
    return () => clearTimeout(timer);
  }, [motionValue, springValue, isInView, delay, value, reduced, decimalPlaces]);

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current && !reducedRef.current) ref.current.textContent = format(latest, decimalPlaces);
      }),
    [springValue, decimalPlaces],
  );

  return (
    <span ref={ref} className={cn("inline-block tabular-nums", className)} {...props}>
      {format(startValue, decimalPlaces)}
    </span>
  );
}
