/** One piece of evidence: a line of the diff, an excerpt of a job log, or a report value. */
export interface Evidence {
  source: "diff" | "log" | "report";
  /** File (diff), or workflow and job (log). */
  where: string;
  line: number | null;
  /** Quoted exactly as it appears in the source, so a seat's quote can be checked against it. */
  text: string;
}

/** What happens when no one answers by the deadline (see the engine's no-answer rule). */
export const NO_ANSWER_OPTIONS = ["fail", "follow-council", "pass", "escalate"] as const;
export type NoAnswerOption = (typeof NO_ANSWER_OPTIONS)[number];

/** The host's fixed list of ways a question can be made easier (see `RelaxRequest`). */
export const RELAX_KINDS = ["council-may-pass"] as const;
export type RelaxKind = (typeof RELAX_KINDS)[number];

/** A typed question an extension raises about the run, for the council and, if needed, a person. */
export interface Question {
  /** `<extension id>:<key>`, for example `core:flaky-test` or `threat-model:T3`. Unique in a run. */
  id: string;
  extension: string;
  /** Unique within the extension's questions for this run. */
  key: string;
  /** What the council is asked, in one sentence. */
  prompt: string;
  /** Plain-language summary of what raised the question. */
  summary: string;
  evidence: Evidence[];
  councilMayPass: boolean;
  /**
   * From an extension in Shadow mode: shown as "would ask", sent to the council
   * so its answers can be measured, but it never changes the run's result and
   * no person is asked.
   */
  shadow: boolean;
  /** A label for display only (for example "P1"); it never changes how the question is decided. */
  severity?: string;
  /** The extension's own no-answer option; the repository's `ask.perExtension` overrides it. */
  onNoAnswer?: NoAnswerOption;
  /** Extra context for the council's seats, sent fenced as quoted data. */
  seatContext?: string;
  /** Who to ask instead of `ask.to`, from the first extension whose `recipients` named someone. */
  askTo?: string[];
  /** Over the run's council cap: asked straight to a person, with no council call. */
  skipCouncil?: boolean;
  /** No relaxation may make this question easier. */
  neverRelax?: boolean;
  /** Set when a relaxation made this question easier. */
  relaxedBy?: { extension: string; kind: RelaxKind; why: string };
}
