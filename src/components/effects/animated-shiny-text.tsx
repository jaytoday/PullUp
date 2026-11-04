// From Magic UI (MIT license), "animated-shiny-text". Changed: theme colors; the keyframes live in
// globals.css (`animate-shiny-text`) and only run when motion is allowed, leaving plain text otherwise.
import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { cn } from "@/lib/utils";

export interface AnimatedShinyTextProps extends ComponentPropsWithoutRef<"span"> {
  shimmerWidth?: number;
}

/** Text with a light passing across it, for "working on it" labels. */
export function AnimatedShinyText({ children, className, shimmerWidth = 100, ...props }: AnimatedShinyTextProps) {
  return (
    <span
      style={{ "--shiny-width": `${shimmerWidth}px` } as CSSProperties}
      className={cn(
        "text-muted-foreground",
        "motion-safe:animate-shiny-text bg-size-[var(--shiny-width)_100%] bg-clip-text bg-position-[0_0] bg-no-repeat",
        "bg-linear-to-r from-transparent via-foreground/80 via-50% to-transparent",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
