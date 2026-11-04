import { cn } from "@/lib/utils"

/** Nuxt UI's `<USeparator label>`: a rule with a centered label. */
function LabelSeparator({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 text-xs font-medium text-body", className)}>
      <span className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

export { LabelSeparator }
