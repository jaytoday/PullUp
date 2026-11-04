"use client";

import { AnimatedListItem, AnimatePresence } from "@/components/effects/animated-list";
import type { RunRow } from "@/server/dashboard";
import { RunLine } from "./run-list";

/** The newest runs; a new run slides in at the top (still under reduced motion). */
export function LiveFeed({ runs }: { runs: RunRow[] }) {
  return (
    <ul className="divide-y overflow-hidden rounded-lg bg-background ring ring-border" data-testid="live-feed">
      <AnimatePresence initial={false}>
        {runs.map((run) => (
          <AnimatedListItem key={run.id}>
            <RunLine run={run} />
          </AnimatedListItem>
        ))}
      </AnimatePresence>
    </ul>
  );
}
