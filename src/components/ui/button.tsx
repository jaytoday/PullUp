import * as React from "react"
import Link from "next/link"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/*
 * Nuxt UI's button language (color × variant × size), which the app was
 * designed in. Passing `color` switches a Button to these styles; without it
 * the shadcn variants above apply unchanged.
 */
export type ButtonColor = "primary" | "secondary" | "neutral" | "success" | "warning" | "error" | "info"
export type ButtonTone = "solid" | "outline" | "soft" | "subtle" | "ghost" | "link"
type ToneSize = "xs" | "sm" | "md" | "lg" | "xl"

const TONES: Record<ButtonTone, Record<ButtonColor, string>> = {
  solid: {
    neutral: "bg-foreground text-background hover:bg-foreground/90",
    primary: "bg-primary text-primary-foreground hover:bg-primary/75 disabled:bg-primary aria-disabled:bg-primary",
    success: "bg-success text-primary-foreground hover:bg-success/75 disabled:bg-success aria-disabled:bg-success",
    warning: "bg-warning text-primary-foreground hover:bg-warning/75 disabled:bg-warning aria-disabled:bg-warning",
    error: "bg-destructive text-white hover:bg-destructive/75 disabled:bg-destructive aria-disabled:bg-destructive",
    info: "bg-info text-white hover:bg-info/75 disabled:bg-info aria-disabled:bg-info",
    secondary: "bg-info text-white hover:bg-info/75 disabled:bg-info aria-disabled:bg-info",
  },
  outline: {
    neutral: "ring ring-inset ring-border-accented bg-background text-body hover:bg-elevated",
    primary: "ring ring-inset ring-primary/50 text-primary hover:bg-primary/10",
    success: "ring ring-inset ring-success/50 text-success hover:bg-success/10",
    warning: "ring ring-inset ring-warning/50 text-warning hover:bg-warning/10",
    error: "ring ring-inset ring-destructive/50 text-destructive hover:bg-destructive/10",
    info: "ring ring-inset ring-info/50 text-info hover:bg-info/10",
    secondary: "ring ring-inset ring-info/50 text-info hover:bg-info/10",
  },
  soft: {
    neutral: "bg-elevated text-body hover:bg-accented/75",
    primary: "bg-primary/10 text-primary hover:bg-primary/15",
    success: "bg-success/10 text-success hover:bg-success/15",
    warning: "bg-warning/10 text-warning hover:bg-warning/15",
    error: "bg-destructive/10 text-destructive hover:bg-destructive/15",
    info: "bg-info/10 text-info hover:bg-info/15",
    secondary: "bg-info/10 text-info hover:bg-info/15",
  },
  subtle: {
    neutral: "ring ring-inset ring-border-accented bg-elevated text-body hover:bg-accented/75",
    primary: "ring ring-inset ring-primary/25 bg-primary/10 text-primary hover:bg-primary/15",
    success: "ring ring-inset ring-success/25 bg-success/10 text-success hover:bg-success/15",
    warning: "ring ring-inset ring-warning/25 bg-warning/10 text-warning hover:bg-warning/15",
    error: "ring ring-inset ring-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15",
    info: "ring ring-inset ring-info/25 bg-info/10 text-info hover:bg-info/15",
    secondary: "ring ring-inset ring-info/25 bg-info/10 text-info hover:bg-info/15",
  },
  ghost: {
    neutral: "text-body hover:bg-elevated data-[state=open]:bg-elevated",
    primary: "text-primary hover:bg-primary/10",
    success: "text-success hover:bg-success/10",
    warning: "text-warning hover:bg-warning/10",
    error: "text-destructive hover:bg-destructive/10",
    info: "text-info hover:bg-info/10",
    secondary: "text-info hover:bg-info/10",
  },
  link: {
    neutral: "text-muted-foreground hover:text-body",
    primary: "text-primary hover:text-primary/75",
    success: "text-success hover:text-success/75",
    warning: "text-warning hover:text-warning/75",
    error: "text-destructive hover:text-destructive/75",
    info: "text-info hover:text-info/75",
    secondary: "text-info hover:text-info/75",
  },
}

const TONE_SIZES: Record<ToneSize, { base: string; square: string; icon: string }> = {
  xs: { base: "px-2 py-1 text-xs gap-1", square: "p-1", icon: "size-4" },
  sm: { base: "px-2.5 py-1.5 text-xs gap-1.5", square: "p-1.5", icon: "size-4" },
  md: { base: "px-2.5 py-1.5 text-sm gap-1.5", square: "p-1.5", icon: "size-5" },
  lg: { base: "px-3 py-2 text-sm gap-2", square: "p-2", icon: "size-5" },
  xl: { base: "px-3 py-2 text-base gap-2", square: "p-2", icon: "size-6" },
}

type ShadcnVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>
type ShadcnSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>

type ButtonProps = Omit<React.ComponentProps<"button">, "color"> & {
  variant?: ShadcnVariant | ButtonTone
  size?: ShadcnSize | ToneSize
  color?: ButtonColor
  asChild?: boolean
  /** Render as a Next.js link. */
  href?: string
  target?: string
  /** Leading icon name (see `<Icon>`). */
  icon?: string
  trailingIcon?: string
  loading?: boolean
  square?: boolean
  block?: boolean
}

function Button({
  className,
  variant,
  size,
  color,
  asChild = false,
  href,
  target,
  icon,
  trailingIcon,
  loading = false,
  square = false,
  block = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  let classes: string
  let iconSize = "size-4"

  if (color) {
    const tone = (variant && variant in TONES ? variant : "solid") as ButtonTone
    const toneSize = (size && size in TONE_SIZES ? size : "sm") as ToneSize
    const s = TONE_SIZES[toneSize]
    iconSize = s.icon
    classes = cn(
      "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-[color,background-color,transform] duration-200 outline-none active:translate-y-px focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-75 [&_svg]:shrink-0",
      TONES[tone][color],
      square ? s.square : s.base,
      block && "w-full",
      className,
    )
  } else {
    classes = cn(
      buttonVariants({
        variant: variant as ShadcnVariant | undefined,
        size: size as ShadcnSize | undefined,
      }),
      block && "w-full",
      className,
    )
  }

  const content = asChild ? children : (
    <>
      {loading ? (
        <Icon name="i-lucide-loader-circle" className={cn(iconSize, "animate-spin")} />
      ) : icon ? (
        <Icon name={icon} className={iconSize} />
      ) : null}
      {children}
      {trailingIcon ? <Icon name={trailingIcon} className={iconSize} /> : null}
    </>
  )

  if (href && !asChild) {
    const external = /^https?:\/\//.test(href) || target === "_blank"
    const linkProps = props as unknown as React.ComponentProps<"a">
    if (external) {
      return (
        <a data-slot="button" href={href} target={target} rel="noopener noreferrer" className={classes} {...linkProps}>
          {content}
        </a>
      )
    }
    return (
      <Link data-slot="button" href={href} target={target} className={classes} {...linkProps}>
        {content}
      </Link>
    )
  }

  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={classes}
      disabled={disabled || loading}
      {...props}
    >
      {content}
    </Comp>
  )
}

export { Button, buttonVariants }
