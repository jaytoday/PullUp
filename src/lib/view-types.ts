import type { Assessment, ConcernCase, HardFailure } from "@pullup/engine";

/** What the run screens receive from the server (dates as text). */
export interface RunView {
  id: string;
  repo: string;
  pull: number | null;
  title: string;
  headSha: string;
  state: string;
  result: "pass" | "fail" | "waiting" | null;
  reason: string | null;
  checkMode: "report_only" | "enforce";
  decider: string | null;
  harness: string | null;
  costUsd: number | null;
  synthetic: boolean;
  error: string | null;
  firstSeenAt: string;
  concerns: ConcernCase[];
  hardFailures: HardFailure[];
  agentSteps: Array<{ tool: string; summary: string; at: string }>;
  ci: Array<{ workflow: string; job: string; attempts: string[] }>;
  notes: string[];
  assessments: Assessment[];
}
