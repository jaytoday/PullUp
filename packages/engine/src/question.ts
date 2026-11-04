import type { TriggerId } from "./config";

/** One piece of evidence: a line of the diff, an excerpt of a job log, or a report value. */
export interface Evidence {
  source: "diff" | "log" | "report";
  /** File (diff), or workflow and job (log). */
  where: string;
  line: number | null;
  /** Quoted exactly as it appears in the source, so a seat's quote can be checked against it. */
  text: string;
}

/** A typed question a trigger raises about the run, for the council and, if needed, a person. */
export interface Question {
  /** Stable within a run: the trigger id (one question per trigger). */
  id: string;
  trigger: TriggerId;
  /** What the council is asked, in one sentence. */
  prompt: string;
  /** Plain-language summary of what fired the trigger. */
  summary: string;
  evidence: Evidence[];
  councilMayPass: boolean;
}
