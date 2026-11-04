import * as React from "react"
import { Icon } from "@/components/icon"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** An Input with a leading icon (Nuxt UI's `<UInput icon="…">`). */
function IconInput({
  icon,
  size = "md",
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "size"> & { icon: string; size?: "md" | "lg" }) {
  return (
    <div className={cn("relative w-full", className)}>
      <Icon
        name={icon}
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-dimmed",
          size === "lg" ? "start-3 size-5" : "start-2.5 size-4",
        )}
      />
      <Input className={cn(size === "lg" ? "py-2 ps-10 pe-3" : "ps-8")} {...props} />
    </div>
  )
}

export { IconInput }
