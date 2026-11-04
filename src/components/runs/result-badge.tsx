import { Badge } from "@/components/ui/badge";

/** The run's result. Never animated: people read it before acting. */
export function ResultBadge({ result, state, mode }: { result: string | null; state: string; mode: string }) {
  const shadow = mode === "shadow";
  if (state === "collecting") return <Badge color="neutral" variant="subtle" icon="i-lucide-hourglass">Collecting</Badge>;
  if (state === "error") return <Badge color="error" variant="subtle" icon="i-lucide-circle-alert">Error</Badge>;
  if (result === "pass") return <Badge color="success" variant="subtle" icon="i-lucide-check">{shadow ? "Would pass" : "Passed"}</Badge>;
  if (result === "fail") return <Badge color="error" variant="subtle" icon="i-lucide-x">{shadow ? "Would fail" : "Failed"}</Badge>;
  return <Badge color="warning" variant="subtle" icon="i-lucide-message-circle-question">{shadow ? "Would ask a person" : "Waiting for a person"}</Badge>;
}

export function ModeBadge({ mode }: { mode: string }) {
  return mode === "active" ? <Badge color="primary" variant="soft">Active</Badge> : <Badge color="neutral" variant="outline">Shadow</Badge>;
}
