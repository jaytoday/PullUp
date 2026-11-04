import * as React from "react"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

/*
 * Nuxt UI's UAlert: an optional icon, a title and/or description, and optional
 * actions, tinted by color × variant.
 */

type AlertColor = "primary" | "secondary" | "neutral" | "success" | "warning" | "error" | "info"
type AlertVariant = "solid" | "outline" | "soft" | "subtle"

const TONES: Record<AlertVariant, Record<AlertColor, string>> = {
  solid: {
    neutral: "bg-foreground text-background",
    primary: "bg-primary text-primary-foreground",
    success: "bg-success text-primary-foreground",
    warning: "bg-warning text-primary-foreground",
    error: "bg-destructive text-white",
    info: "bg-info text-white",
    secondary: "bg-info text-white",
  },
  outline: {
    neutral: "text-body bg-background ring ring-inset ring-border",
    primary: "text-primary ring ring-inset ring-primary/25",
    success: "text-success ring ring-inset ring-success/25",
    warning: "text-warning ring ring-inset ring-warning/25",
    error: "text-destructive ring ring-inset ring-destructive/25",
    info: "text-info ring ring-inset ring-info/25",
    secondary: "text-info ring ring-inset ring-info/25",
  },
  soft: {
    neutral: "text-body bg-elevated/50",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    error: "bg-destructive/10 text-destructive",
    info: "bg-info/10 text-info",
    secondary: "bg-info/10 text-info",
  },
  subtle: {
    neutral: "text-body bg-elevated/50 ring ring-inset ring-border-accented",
    primary: "bg-primary/10 text-primary ring ring-inset ring-primary/25",
    success: "bg-success/10 text-success ring ring-inset ring-success/25",
    warning: "bg-warning/10 text-warning ring ring-inset ring-warning/25",
    error: "bg-destructive/10 text-destructive ring ring-inset ring-destructive/25",
    info: "bg-info/10 text-info ring ring-inset ring-info/25",
    secondary: "bg-info/10 text-info ring ring-inset ring-info/25",
  },
}

function Alert({
  title,
  description,
  icon,
  color = "primary",
  variant = "solid",
  actions,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title" | "color"> & {
  title?: React.ReactNode
  description?: React.ReactNode
  icon?: string
  color?: AlertColor
  variant?: AlertVariant
  actions?: React.ReactNode
}) {
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn("relative flex w-full gap-2.5 overflow-hidden rounded-lg p-4", TONES[variant][color], className)}
      {...props}
    >
      {icon ? <Icon name={icon} className="size-5 shrink-0" /> : null}
      <div className="min-w-0 flex-1">
        {title ? <div className="text-sm font-medium">{title}</div> : null}
        {description ? <div className={cn("text-sm opacity-90", title && "mt-1")}>{description}</div> : null}
        {children}
        {actions ? <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{actions}</div> : null}
      </div>
    </div>
  )
}

export { Alert }
