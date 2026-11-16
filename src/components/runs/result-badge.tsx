"use client";

import { Badge } from "@astryxdesign/core/Badge";

const VARIANT = { pass: "success", fail: "error", waiting: "warning" } as const;
const LABEL = { pass: "PASS", fail: "FAIL", waiting: "WAITING FOR A PERSON" } as const;

export function ResultBadge({ result, state }: { result: "pass" | "fail" | "waiting" | null; state: string }) {
  if (state === "error") return <Badge variant="error" label="ERROR" />;
  if (!result) return <Badge variant="neutral" label={state.toUpperCase()} />;
  return <Badge variant={VARIANT[result]} label={LABEL[result]} />;
}
