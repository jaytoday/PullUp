"use client"

import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

/*
 * A segmented control: a row of options in one track, the selected ones
 * raised. Ported from nikala-ui's toggle group look onto radix. Used for the
 * list filter (All · Real · Practice), the 1–5 scale, and the voices picker.
 */
type ToggleSize = "xs" | "sm" | "md" | "lg"

const SizeContext = React.createContext<ToggleSize>("sm")

const ITEM_SIZES: Record<ToggleSize, string> = {
  xs: "h-6 px-2 text-xs gap-1",
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "min-h-11 px-4 text-base gap-2",
}

function ToggleGroup({
  className,
  size = "sm",
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & { size?: ToggleSize }) {
  return (
    <SizeContext.Provider value={size}>
      <ToggleGroupPrimitive.Root
        data-slot="toggle-group"
        className={cn("inline-flex w-fit items-center gap-0.5 rounded-lg bg-elevated p-0.5", className)}
        {...props}
      />
    </SizeContext.Provider>
  )
}

function ToggleGroupItem({
  className,
  icon,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & { icon?: string }) {
  const size = React.useContext(SizeContext)
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex flex-1 items-center justify-center rounded-md font-medium whitespace-nowrap text-toned transition-colors outline-none",
        "hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs",
        "disabled:pointer-events-none disabled:opacity-50",
        ITEM_SIZES[size],
        className
      )}
      {...props}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
