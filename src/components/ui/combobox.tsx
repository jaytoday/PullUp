"use client"

import * as React from "react"
import { Icon } from "@/components/icon"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { inputClasses } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface ComboboxItem {
  value: string
  label: string
  description?: string
  /** Extra text matched by search (e.g. a dial code). */
  keywords?: string[]
}

/**
 * A searchable single-select (Nuxt UI's UInputMenu / USelectMenu): a trigger
 * that looks like an input, opening a filterable list.
 */
function Combobox({
  items,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  icon,
  className,
  contentClassName,
  renderValue,
  renderItem,
}: {
  items: ComboboxItem[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  icon?: string
  className?: string
  contentClassName?: string
  renderValue?: (item: ComboboxItem | undefined) => React.ReactNode
  renderItem?: (item: ComboboxItem) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const selected = items.find((item) => item.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(inputClasses, "flex items-center gap-2 text-start", className)}
        >
          {icon ? <Icon name={icon} className="size-4 shrink-0 text-dimmed" /> : null}
          <span className={cn("min-w-0 flex-1 truncate", !selected && !value && "text-dimmed")}>
            {renderValue ? renderValue(selected) : (selected?.label ?? (value || placeholder))}
          </span>
          <Icon name="i-lucide-chevrons-up-down" className="size-4 shrink-0 text-dimmed" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("w-(--radix-popover-trigger-width) min-w-48 p-0", contentClassName)}>
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.value}
                  value={item.value}
                  keywords={[item.label, item.description ?? "", ...(item.keywords ?? [])]}
                  onSelect={() => {
                    onChange(item.value)
                    setOpen(false)
                  }}
                >
                  {renderItem ? (
                    renderItem(item)
                  ) : (
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                      {item.description ? <span className="ms-1.5 text-muted-foreground">{item.description}</span> : null}
                    </span>
                  )}
                  {item.value === value ? <Icon name="i-lucide-check" className="ms-auto size-4" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { Combobox }
