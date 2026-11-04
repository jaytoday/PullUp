import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/* Nuxt UI's badge language; passing `color` switches to it (see Button). */
export type BadgeColor = "primary" | "secondary" | "neutral" | "success" | "warning" | "error" | "info"
type BadgeTone = "solid" | "outline" | "soft" | "subtle"
type BadgeSize = "xs" | "sm" | "md" | "lg"

const TONES: Record<BadgeTone, Record<BadgeColor, string>> = {
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
    neutral: "ring ring-inset ring-border-accented text-body bg-background",
    primary: "ring ring-inset ring-primary/50 text-primary",
    success: "ring ring-inset ring-success/50 text-success",
    warning: "ring ring-inset ring-warning/50 text-warning",
    error: "ring ring-inset ring-destructive/50 text-destructive",
    info: "ring ring-inset ring-info/50 text-info",
    secondary: "ring ring-inset ring-info/50 text-info",
  },
  soft: {
    neutral: "bg-elevated text-body",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    error: "bg-destructive/10 text-destructive",
    info: "bg-info/10 text-info",
    secondary: "bg-info/10 text-info",
  },
  subtle: {
    neutral: "ring ring-inset ring-border-accented bg-elevated text-body",
    primary: "ring ring-inset ring-primary/25 bg-primary/10 text-primary",
    success: "ring ring-inset ring-success/25 bg-success/10 text-success",
    warning: "ring ring-inset ring-warning/25 bg-warning/10 text-warning",
    error: "ring ring-inset ring-destructive/25 bg-destructive/10 text-destructive",
    info: "ring ring-inset ring-info/25 bg-info/10 text-info",
    secondary: "ring ring-inset ring-info/25 bg-info/10 text-info",
  },
}

const SIZES: Record<BadgeSize, string> = {
  xs: "text-[8px]/3 px-1 py-0.5 gap-1 rounded-xs",
  sm: "text-[10px]/3 px-1.5 py-1 gap-1 rounded-xs",
  md: "text-xs px-2 py-1 gap-1 rounded-sm",
  lg: "text-sm px-2 py-1 gap-1.5 rounded-sm",
}

type ShadcnBadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

function Badge({
  className,
  variant,
  color,
  size,
  icon,
  asChild = false,
  children,
  ...props
}: Omit<React.ComponentProps<"span">, "color"> & {
  variant?: ShadcnBadgeVariant | BadgeTone
  color?: BadgeColor
  size?: BadgeSize
  icon?: string
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "span"

  const classes = color
    ? cn(
        "inline-flex items-center font-medium whitespace-nowrap",
        TONES[(variant && variant in TONES ? variant : "solid") as BadgeTone][color],
        SIZES[size ?? "md"],
        className,
      )
    : cn(badgeVariants({ variant: variant as ShadcnBadgeVariant | undefined }), className)

  return (
    <Comp data-slot="badge" data-variant={variant} className={classes} {...props}>
      {icon && !asChild ? <Icon name={icon} className="size-3" /> : null}
      {children}
    </Comp>
  )
}

export { Badge, badgeVariants }
