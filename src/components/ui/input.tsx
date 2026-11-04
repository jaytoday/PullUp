"use client"

import * as React from "react"
import { useFormFieldId } from "@/components/ui/form-field"
import { cn } from "@/lib/utils"

// Nuxt UI's UInput look: a ringed field that turns primary on focus.
const inputClasses =
  "w-full min-w-0 rounded-md bg-background px-2.5 py-1.5 text-sm text-foreground ring ring-inset ring-border-accented outline-none transition-colors placeholder:text-dimmed focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-75 aria-invalid:ring-destructive file:border-0 file:bg-transparent file:text-sm file:font-medium"

function Input({ className, type, id, ...props }: React.ComponentProps<"input">) {
  const fieldId = useFormFieldId(id)
  return <input type={type} id={fieldId} data-slot="input" className={cn(inputClasses, className)} {...props} />
}

export { Input, inputClasses }
