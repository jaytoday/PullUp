"use client";

import CountUp from "@/components/effects/count-up";
import { Gauge } from "@/components/effects/gauge";

/** One trigger's agreement with people: Magic UI's gauge and React Bits' CountUp (both still with reduced motion). */
export function AgreementTile({ trigger, agreed, total }: { trigger: string; agreed: number; total: number }) {
  const pct = Math.round((agreed / total) * 100);
  return (
    <div className="flex items-center gap-4 rounded-lg bg-background p-4 ring ring-border" data-testid={`agreement-${trigger}`}>
      <Gauge value={pct} label={`${pct}% agreement`} className="size-16 text-sm" />
      <div>
        <p className="font-mono text-xs text-muted-foreground">{trigger}</p>
        <p className="text-3xl font-semibold text-foreground tabular-nums">
          <CountUp to={pct} />%
        </p>
        <p className="text-xs text-muted-foreground">
          {agreed} of {total} answers
        </p>
      </div>
    </div>
  );
}
