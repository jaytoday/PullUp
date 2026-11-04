"use client";

import { useRef, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { HeroBackdrop } from "@/components/landing/hero-backdrop";
import { LogTerminal } from "@/components/runs/log-terminal";
import { QuestionStatus } from "@/components/runs/question-status";
import { Button } from "@/components/ui/button";
import { Spotlight } from "@/components/ui/spotlight-new";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { AnimatedBeam } from "./animated-beam";
import { AnimatedListItem, AnimatePresence } from "./animated-list";
import { BlurFade } from "./blur-fade";
import { BorderBeam } from "./border-beam";
import { celebrate } from "./confetti";
import CountUp from "./count-up";
import DecryptedText from "./decrypted-text";
import { DotPattern } from "./dot-pattern";
import { Gauge } from "./gauge";
import { NumberTicker } from "./number-ticker";

function Sample({ name, where, children }: { name: string; where: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2" data-testid={`effect-${name}`}>
      <h2 className="font-mono text-xs text-muted-foreground">
        {name} <span className="font-sans">· {where}</span>
      </h2>
      {children}
    </section>
  );
}

const BOX = "rounded-lg bg-background p-4 text-sm text-body ring ring-border";

/**
 * Every effect PullUp uses, with sample content and where it appears, for checking them by eye in
 * light mode, dark mode and with reduced motion, and for `e2e/effects.mjs`. Development builds only.
 */
export function EffectsGallery() {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(12);
  const [items, setItems] = useState(["acme/shop #41", "acme/shop #42"]);
  const [outcome, setOutcome] = useState<"ask" | "pass">("ask");
  const beamBox = useRef<HTMLDivElement>(null);
  const beamFrom = useRef<HTMLDivElement>(null);
  const beamTo = useRef<HTMLDivElement>(null);

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <Sample name="number-ticker" where="Magic UI · overview counts">
        <div className={BOX}>
          <p className="text-3xl font-semibold text-foreground" data-testid="ticker-value">
            <NumberTicker value={count} />
          </p>
          <Button className="mt-3" onClick={() => setCount((value) => value + 100)}>
            Add 100
          </Button>
        </div>
      </Sample>

      <Sample name="animated-list" where="Magic UI · overview live feed">
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
          <Button className="mt-3" onClick={() => setItems((list) => [`acme/shop #${41 + list.length}`, ...list])}>
            Add a run
          </Button>
        </div>
      </Sample>

      <Sample name="border-beam" where="Magic UI · run detail while a worker holds the run">
        <div className={`relative ${BOX}`}>
          The council is answering
          <BorderBeam />
        </div>
      </Sample>

      <Sample name="gauge" where="Magic UI · seats answered, agreement with people">
        <div className={`flex items-center gap-4 ${BOX}`}>
          <Gauge value={3} max={4} label="3 of 4 seat answers received" />
          <span>3 of 4 seat answers received</span>
        </div>
      </Sample>

      <Sample name="terminal" where="Magic UI · hard failure log">
        <LogTerminal title="ci / test: end of the log" log={"FAIL src/cart.test.ts\n  ● rounds totals to cents\n    Expected: 0.3\n    Received: 0.30000000000000004"} />
      </Sample>

      <Sample name="animated-beam" where="Magic UI · landing page flow">
        <div ref={beamBox} className={`relative flex items-center justify-between ${BOX}`}>
          <div ref={beamFrom} className="rounded-md bg-elevated px-3 py-2">
            CI
          </div>
          <div ref={beamTo} className="rounded-md bg-elevated px-3 py-2">
            Council
          </div>
          <AnimatedBeam containerRef={beamBox} fromRef={beamFrom} toRef={beamTo} />
        </div>
      </Sample>

      <Sample name="blur-fade" where="Magic UI · steps of repo setup">
        <BlurFade className={BOX}>
          <p data-testid="blur-fade-content">A setup step fades into place.</p>
        </BlurFade>
      </Sample>

      <Sample name="dot-pattern" where="Magic UI · overview tiles; still fallback for the hero">
        <div className={`relative isolate h-32 overflow-hidden ${BOX}`}>
          <DotPattern className="-z-10 text-border mask-[radial-gradient(ellipse_at_center,white,transparent_75%)]" />
          A quiet background
        </div>
      </Sample>

      <Sample name="confetti" where="Magic UI · first council pass on a repo, once">
        <div className={BOX}>
          <Button onClick={() => celebrate()}>Celebrate</Button>
        </div>
      </Sample>

      <Sample name="dot-grid" where="React Bits (WebGL) · landing hero">
        <div className={`relative isolate h-40 overflow-hidden ${BOX}`}>
          <HeroBackdrop />
          Move the pointer over the dots
        </div>
      </Sample>

      <Sample name="decrypted-text" where="React Bits · sign-in headline">
        <p className={`text-xl font-semibold text-foreground ${BOX}`} data-testid="decrypted">
          <DecryptedText text="CI that knows when to ask" animateOn="view" sequential revealDirection="start" speed={40} />
        </p>
      </Sample>

      <Sample name="count-up" where="React Bits · accuracy">
        <p className={`text-3xl font-semibold text-foreground ${BOX}`} data-testid="count-up-value">
          <CountUp to={87} />%
        </p>
      </Sample>

      <Sample name="status-mark" where="React Bits · a question resolves">
        <div className={`flex items-center gap-3 ${BOX}`}>
          <QuestionStatus outcome={outcome} />
          <Button size="sm" onClick={() => setOutcome(outcome === "ask" ? "pass" : "ask")}>
            {outcome === "ask" ? "Answer pass" : "Back to waiting"}
          </Button>
        </div>
      </Sample>

      <Sample name="spotlight-card" where="React Bits · empty states">
        <EmptyState icon="i-lucide-inbox" title="No runs yet" description="Runs appear when a required workflow finishes." action={{ href: "/setup", label: "Set up a repo" }} />
      </Sample>

      <Sample name="spotlight" where="Aceternity · sign-in background">
        <div className={`relative isolate h-40 overflow-hidden ${BOX}`}>
          {reduced ? null : (
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" data-effect="spotlight">
              <Spotlight gradientFirst="radial-gradient(68.54% 68.72% at 55.02% 31.46%, color-mix(in oklab, var(--primary) 18%, transparent) 0, transparent 80%)" />
            </div>
          )}
          A slow light behind the sign-in form
        </div>
      </Sample>
    </div>
  );
}
