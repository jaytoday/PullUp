import type { ReviewActionRecord } from "@/lib/api";
import { cn } from "@/lib/cn";

const STYLE: Record<ReviewActionRecord["status"], { label: string; cls: string; hint: string }> = {
  logged: { label: "Logged", cls: "text-muted-foreground", hint: "Recorded only — live GitHub delivery is off" },
  suppressed: { label: "Suppressed", cls: "text-muted-foreground", hint: "Authority is off: nothing to send" },
  sent: { label: "Sent", cls: "text-band-fast", hint: "Reached GitHub" },
  skipped: { label: "Skipped", cls: "text-band-review", hint: "Not sent: head moved, PR closed, or already sent" },
  denied: { label: "Denied", cls: "text-destructive", hint: "PullUp had no authority to send this" },
  failed: { label: "Failed", cls: "text-destructive", hint: "At least one GitHub call failed" },
};

/** What happened to a recorded review action (logged / sent / skipped / denied / failed / suppressed). */
export function DeliveryStatus(props: { record: Pick<ReviewActionRecord, "status" | "delivery">; class?: string }) {
  const s = () => STYLE[props.record.status];
  const title = () => props.record.delivery?.errors?.join("\n") ?? props.record.delivery?.denied?.join("\n") ?? props.record.delivery?.skipped ?? s().hint;
  return (
    <span class={cn("num text-[11px] font-medium", s().cls, props.class)} title={title()} data-status={props.record.status}>
      {s().label}
    </span>
  );
}
