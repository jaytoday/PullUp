"use client";

import { useEffect } from "react";
import { celebrate } from "@/components/effects/confetti";

/** Confetti, once per repository and browser, the first time the council passes a run there (skipped with reduced motion). */
export function FirstCouncilPass({ repos }: { repos: string[] }) {
  useEffect(() => {
    for (const repo of repos) {
      const key = `pullup:first-council-pass:${repo}`;
      try {
        if (localStorage.getItem(key)) continue;
        localStorage.setItem(key, "1");
      } catch {
        continue;
      }
      celebrate();
      break;
    }
  }, [repos]);
  return null;
}
