// Adapted from Magic UI (MIT license), "dot-pattern". Changed: a still SVG pattern (the original's
// optional glowing dots are left out), colored with the current text color.
import { useId } from "react";
import { cn } from "@/lib/utils";

interface DotPatternProps extends React.SVGProps<SVGSVGElement> {
  /** Spacing between dots in pixels. */
  spacing?: number;
  radius?: number;
}

/** A quiet dotted background. Place inside a `relative` parent; fade it with a `mask-*` class. */
export function DotPattern({ spacing = 16, radius = 1, className, ...props }: DotPatternProps) {
  const id = useId();
  return (
    <svg
      aria-hidden
      data-effect="dot-pattern"
      className={cn("pointer-events-none absolute inset-0 size-full text-muted-foreground/30", className)}
      {...props}
    >
      <defs>
        <pattern id={id} width={spacing} height={spacing} patternUnits="userSpaceOnUse">
          <circle cx={spacing / 2} cy={spacing / 2} r={radius} fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
