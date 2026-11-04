import { cn } from "@/lib/utils";

/** PullUp's mark: a check climbing out of a bar. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("inline-block shrink-0", className)}>
      <path d="M5 27h22" strokeOpacity="0.45" />
      <path d="M7 16l6 6L26 6" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 text-foreground", className)}>
      <Logo className="size-[22px] text-primary" />
      <span className="text-sm font-semibold tracking-tight">PullUp</span>
    </span>
  );
}
