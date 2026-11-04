"use client"

import * as React from "react"
import { useFormFieldId } from "@/components/ui/form-field"
import { inputClasses } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** A ringed textarea; `autoresize` grows it with its content. */
function Textarea({
  className,
  autoresize = false,
  onInput,
  id,
  ...props
}: React.ComponentProps<"textarea"> & { autoresize?: boolean }) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const fieldId = useFormFieldId(id)

  const resize = React.useCallback(() => {
    const el = ref.current
    if (!el || !autoresize) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [autoresize])

  React.useLayoutEffect(resize, [resize, props.value])

  return (
    <textarea
      ref={ref}
      id={fieldId}
      data-slot="textarea"
      className={cn(inputClasses, autoresize ? "resize-none overflow-hidden" : "resize-y", className)}
      onInput={(event) => {
        resize()
        onInput?.(event)
      }}
      {...props}
    />
  )
}

export { Textarea }
