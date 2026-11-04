"use client"

import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

/*
 * Radio group with two looks. `default` is a dot and a label; `card` is the
 * large selectable card from nikala-ui, used where each choice needs an icon
 * and a sentence of explanation (the kind picker, "Add to a skill").
 */
type RadioVariant = "default" | "card"

const RadioVariantContext = React.createContext<RadioVariant>("default")

function RadioGroup({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root> & { variant?: RadioVariant }) {
  return (
    <RadioVariantContext.Provider value={variant}>
      <RadioGroupPrimitive.Root
        data-slot="radio-group"
        className={cn(variant === "card" ? "grid gap-3" : "grid gap-2", className)}
        {...props}
      />
    </RadioVariantContext.Provider>
  )
}

function RadioGroupItem({
  className,
  label,
  description,
  icon,
  children,
  ...props
}: Omit<React.ComponentProps<typeof RadioGroupPrimitive.Item>, "children"> & {
  label?: React.ReactNode
  description?: React.ReactNode
  /** `i-lucide-*` name, shown on card items. */
  icon?: string
  children?: React.ReactNode
}) {
  const variant = React.useContext(RadioVariantContext)

  if (variant === "card") {
    return (
      <RadioGroupPrimitive.Item
        data-slot="radio-group-item"
        className={cn(
          "group/radio flex w-full min-h-11 items-start gap-3 rounded-lg border bg-background p-4 text-left transition-colors outline-none",
          "hover:bg-elevated focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary/5 data-[state=checked]:ring-1 data-[state=checked]:ring-primary/40",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {icon ? (
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-elevated text-toned group-data-[state=checked]/radio:bg-primary/15 group-data-[state=checked]/radio:text-primary">
            <Icon name={icon} className="size-5" />
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          {label ? <span className="block font-medium text-foreground">{label}</span> : null}
          {description ? <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span> : null}
          {children}
        </span>
        <span className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border border-border-accented group-data-[state=checked]/radio:border-primary group-data-[state=checked]/radio:bg-primary">
          <RadioGroupPrimitive.Indicator>
            <span className="block size-1.5 rounded-full bg-primary-foreground" />
          </RadioGroupPrimitive.Indicator>
        </span>
      </RadioGroupPrimitive.Item>
    )
  }

  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm", className)}>
      <RadioGroupPrimitive.Item
        data-slot="radio-group-item"
        className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border-accented outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      >
        <RadioGroupPrimitive.Indicator>
          <span className="block size-1.5 rounded-full bg-primary-foreground" />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
      {label ?? children}
    </label>
  )
}

export { RadioGroup, RadioGroupItem }
