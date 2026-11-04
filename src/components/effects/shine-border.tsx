// From Magic UI (MIT license), "shine-border". Changed: theme color by default; the keyframes live in
// globals.css (`animate-shine`) and only run when motion is allowed.
import { cn } from "@/lib/utils";

interface ShineBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  borderWidth?: number;
  /** Seconds for one sweep. */
  duration?: number;
  shineColor?: string | string[];
}

/** A soft light sweeping along its parent's border. The parent needs `position: relative`. */
export function ShineBorder({
  borderWidth = 1,
  duration = 8,
  shineColor = "var(--primary)",
  className,
  style,
  ...props
}: ShineBorderProps) {
  return (
    <div
      aria-hidden
      data-effect="shine-border"
      style={
        {
          "--border-width": `${borderWidth}px`,
          "--duration": `${duration}s`,
          backgroundImage: `radial-gradient(transparent,transparent, ${Array.isArray(shineColor) ? shineColor.join(",") : shineColor},transparent,transparent)`,
          backgroundSize: "300% 300%",
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          padding: "var(--border-width)",
          ...style,
        } as React.CSSProperties
      }
      className={cn(
        "pointer-events-none absolute inset-0 size-full rounded-[inherit] will-change-[background-position] motion-safe:animate-shine",
        className,
      )}
      {...props}
    />
  );
}
