"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * The id a field's control should use so its label points at it. FormField
 * makes one when no `htmlFor` is given; Input (and other controls) pick it up
 * when they have no id of their own.
 */
const FormFieldIdContext = React.createContext<string | undefined>(undefined)

function useFormFieldId(own?: string) {
  const fromField = React.useContext(FormFieldIdContext)
  return own ?? fromField
}

/** Nuxt UI's UFormField: label (+ hint), control, then description/help/error. */
function FormField({
  label,
  hint,
  description,
  help,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label?: React.ReactNode
  hint?: React.ReactNode
  description?: React.ReactNode
  help?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  const generated = React.useId()
  const id = htmlFor ?? generated
  return (
    <FormFieldIdContext.Provider value={id}>
    <div data-slot="form-field" className={cn("text-sm", className)}>
      {label || hint ? (
        <div className="flex items-center justify-between gap-1">
          {label ? (
            <label htmlFor={id} className="block font-medium text-body">
              {label}
              {required ? <span className="ms-0.5 text-error">*</span> : null}
            </label>
          ) : null}
          {hint ? <span className="text-muted-foreground">{hint}</span> : null}
        </div>
      ) : null}
      {description ? <p className="text-muted-foreground">{description}</p> : null}
      <div className={cn(label || description ? "mt-1" : undefined)}>{children}</div>
      {error ? (
        <p className="mt-2 text-error">{error}</p>
      ) : help ? (
        <p className="mt-2 text-muted-foreground">{help}</p>
      ) : null}
    </div>
    </FormFieldIdContext.Provider>
  )
}

export { FormField, useFormFieldId }
