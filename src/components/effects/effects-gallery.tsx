"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AnimatedBeam } from "./animated-beam";
import { AnimatedListItem, AnimatePresence } from "./animated-list";
import { AnimatedShinyText } from "./animated-shiny-text";
import { BlurFade } from "./blur-fade";
import { BorderBeam } from "./border-beam";
import { DotPattern } from "./dot-pattern";
import { NumberTicker } from "./number-ticker";
import { ShineBorder } from "./shine-border";

function Sample({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2" data-testid={`effect-${name}`}>
      <h2 className="font-mono text-xs text-muted-foreground">{name}</h2>
      {children}
    </section>
  );
}

const BOX = "rounded-lg bg-background p-4 text-sm text-body ring ring-border";

/**
 * Every effect in `src/components/effects` with sample content, for checking them by eye in light
 * mode, dark mode and with reduced motion, and for the end-to-end test. Development builds only.
 */
export function EffectsGallery() {
  const [count, setCount] = useState(1234);
  const [items, setItems] = useState(["First item", "Second item"]);
  const beamBox = useRef<HTMLDivElement>(null);
  const beamFrom = useRef<HTMLDivElement>(null);
  const beamTo = useRef<HTMLDivElement>(null);

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <Sample name="number-ticker">
        <div className={BOX}>
          <p className="text-3xl font-semibold text-foreground" data-testid="ticker-value">
            <NumberTicker value={count} />
          </p>
          <Button className="mt-3" onClick={() => setCount((value) => value + 100)}>
            Add 100
          </Button>
        </div>
      </Sample>

      <Sample name="blur-fade">
        <BlurFade className={BOX}>
          <p data-testid="blur-fade-content">This card fades and un-blurs into place.</p>
        </BlurFade>
      </Sample>

      <Sample name="border-beam">
        <div className={`relative ${BOX}`}>
          A run in progress
          <BorderBeam />
        </div>
      </Sample>

      <Sample name="shine-border">
        <div className={`relative ${BOX}`}>
          A tool call that is busy
          <ShineBorder borderWidth={1.5} />
        </div>
      </Sample>

      <Sample name="animated-shiny-text">
        <div className={BOX}>
          <AnimatedShinyText>Reading the situation…</AnimatedShinyText>
        </div>
      </Sample>

      <Sample name="animated-list">
        <div className={BOX}>
          <ul className="grid gap-2" data-testid="animated-list">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <AnimatedListItem key={item} className="rounded-md bg-elevated/60 px-3 py-2">
                  {item}
                </AnimatedListItem>
              ))}
            </AnimatePresence>
          </ul>
          <Button className="mt-3" onClick={() => setItems((list) => [`Item ${list.length + 1}`, ...list])}>
            Add item
          </Button>
        </div>
      </Sample>

      <Sample name="animated-beam">
        <div ref={beamBox} className={`relative flex items-center justify-between ${BOX}`}>
          <div ref={beamFrom} className="rounded-md bg-elevated px-3 py-2">
            From
          </div>
          <div ref={beamTo} className="rounded-md bg-elevated px-3 py-2">
            To
          </div>
          <AnimatedBeam containerRef={beamBox} fromRef={beamFrom} toRef={beamTo} />
        </div>
      </Sample>

      <Sample name="dot-pattern">
        <div className={`relative isolate h-32 overflow-hidden ${BOX}`}>
          <DotPattern className="-z-10 mask-[radial-gradient(ellipse_at_center,white,transparent_75%)]" />
          A quiet background
        </div>
      </Sample>
    </div>
  );
}
