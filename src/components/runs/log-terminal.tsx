"use client";

import { AnimatedSpan, Terminal } from "@/components/effects/terminal";

/** The end of a failed job's log in Magic UI's terminal window; lines appear in order (at once with reduced motion). */
export function LogTerminal({ log, title }: { log: string; title: string }) {
  const lines = log.split("\n").slice(-30);
  return (
    <Terminal className="max-h-none w-full max-w-none" sequence={false}>
      <span className="text-muted-foreground">{title}</span>
      {lines.map((line, i) => (
        <AnimatedSpan key={i} delay={i * 40} className="whitespace-pre-wrap break-all text-body">
          {line || " "}
        </AnimatedSpan>
      ))}
    </Terminal>
  );
}
