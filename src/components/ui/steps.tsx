import * as React from "react"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

/*
 * A compact horizontal row of steps on one rail, from nikala-ui's "steps".
 * Read-only: it shows where something is, it isn't navigation. Below `sm` it
 * collapses to "Current · 2 of 4" so it never forces a horizontal scroll.
 */
export interface StepItem {
  label: string
}

function Steps({ items, current, className }: { items: StepItem[]; current: number; className?: string }) {
  const active = items[current]
  return (
    <div className={cn("w-full", className)} aria-label="Progress">
      <p className="text-xs text-toned sm:hidden">
        <span className="font-medium text-foreground">{active?.label}</span> · {current + 1} of {items.length}
      </p>
      <ol className="relative hidden items-start sm:flex">
        <div aria-hidden="true" className="absolute top-3 right-[12.5%] left-[12.5%] h-px bg-border" />
        {items.map((item, index) => {
          const done = index < current
          const isCurrent = index === current
          return (
            <li
              key={item.label}
              aria-current={isCurrent ? "step" : undefined}
              className="relative z-10 flex flex-1 flex-col items-center gap-1 text-center"
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-md border font-mono text-[11px] font-semibold",
                  done && "border-primary/40 bg-primary/15 text-primary",
                  isCurrent && "border-primary bg-primary text-primary-foreground shadow-xs",
                  !done && !isCurrent && "border-border bg-background text-dimmed"
                )}
              >
                {done ? <Icon name="i-lucide-check" className="size-3" /> : index + 1}
              </span>
              <span className={cn("text-xs", isCurrent ? "font-medium text-foreground" : "text-toned")}>{item.label}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export { Steps }
