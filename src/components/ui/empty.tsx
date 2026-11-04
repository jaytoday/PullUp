import * as React from "react"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

/* An empty state: icon, title, a sentence, and what to do next (nikala-ui's "empty"). */
function Empty({
  icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: string
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-lg border border-dashed px-6 py-10 text-center", className)}>
      {icon ? (
        <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-elevated text-toned">
          <Icon name={icon} className="size-5" />
        </span>
      ) : null}
      <p className="font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  )
}

export { Empty }
