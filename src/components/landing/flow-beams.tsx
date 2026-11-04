"use client";

import { forwardRef, useRef } from "react";
import { AnimatedBeam } from "@/components/effects/animated-beam";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const Node = forwardRef<HTMLDivElement, { icon: string; label: string; className?: string }>(({ icon, label, className }, ref) => (
  <div className="flex flex-col items-center gap-2">
    <div ref={ref} className={cn("z-10 flex size-12 items-center justify-center rounded-full bg-background shadow-sm ring ring-border sm:size-14", className)}>
      <Icon name={icon} className="size-5 text-foreground sm:size-6" />
    </div>
    <span className="text-center text-xs text-muted-foreground">{label}</span>
  </div>
));
Node.displayName = "Node";

/** The path of a run: CI → triggers (code) → council (AI) → a person, drawn with Magic UI's animated beams. */
export function FlowBeams() {
  const box = useRef<HTMLDivElement>(null);
  const ci = useRef<HTMLDivElement>(null);
  const triggers = useRef<HTMLDivElement>(null);
  const council = useRef<HTMLDivElement>(null);
  const person = useRef<HTMLDivElement>(null);
  return (
    <div ref={box} className="relative mx-auto flex w-full max-w-2xl items-start justify-between px-2 py-6" data-testid="flow-beams">
      <Node ref={ci} icon="i-lucide-workflow" label="CI finishes" />
      <Node ref={triggers} icon="i-lucide-scan-search" label="Code finds what is tricky" />
      <Node ref={council} icon="i-lucide-users" label="A council of AI reviewers" className="ring-primary" />
      <Node ref={person} icon="i-lucide-user-round" label="A person, if still unclear" />
      <AnimatedBeam containerRef={box} fromRef={ci} toRef={triggers} startYOffset={-12} endYOffset={-12} />
      <AnimatedBeam containerRef={box} fromRef={triggers} toRef={council} startYOffset={-12} endYOffset={-12} delay={0.6} />
      <AnimatedBeam containerRef={box} fromRef={council} toRef={person} startYOffset={-12} endYOffset={-12} delay={1.2} />
    </div>
  );
}
