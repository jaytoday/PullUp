"use client";

import StatusMark from "@/components/effects/status-mark";

/** React Bits' StatusMark beside a question: it draws its tick or cross when the question resolves (still with reduced motion). */
export function QuestionStatus({ outcome }: { outcome: "pass" | "fail" | "ask" }) {
  return (
    <span data-effect="status-mark" data-outcome={outcome} className="text-warning">
      <StatusMark status={outcome === "pass" ? "done" : outcome === "fail" ? "failed" : "running"} size={22} doneColor="var(--success)" errorColor="var(--destructive)" label={outcome === "pass" ? "Passed" : outcome === "fail" ? "Failed" : "Needs a person"} />
    </span>
  );
}
