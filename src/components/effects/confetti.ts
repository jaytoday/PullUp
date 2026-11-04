// Wraps canvas-confetti the way Magic UI's "confetti" component does (MIT license). Kept to one
// function: a single small burst for a real win, skipped entirely with reduced motion.
"use client";

import confetti from "canvas-confetti";

/** One small burst of confetti, from `origin` (0 to 1 across and down the window). */
export function celebrate(origin: { x: number; y: number } = { x: 0.5, y: 0.6 }) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  void confetti({ particleCount: 80, spread: 70, startVelocity: 35, origin, disableForReducedMotion: true });
}
