import { z } from "zod";
import type { ParsedCiRun, PullInfo, ReadFile } from "./ci";
import type { DiffFile } from "./diff";
import { NO_ANSWER_OPTIONS, type Question, RELAX_KINDS, type RelaxKind } from "./question";
import type { ScreenAnswer, ScreenRequest } from "./screen";

/**
 * The extension interface. An extension is a TypeScript module bundled with
 * PullUp (never code loaded from a repository) that looks at a run and may add
 * questions, facts, notes and annotations. It is a pure function of what the
 * host gives it: no network, no clock (the host passes `now`), no randomness,
 * no database. It can only add work: it cannot pass, drop or soften another
 * extension's question. The one way a question gets easier is a relaxation from
 * the host's fixed list, which the host applies only when a `loosens` setting
 * allows it.
 */

export type ExtensionMode = "off" | "shadow" | "active";

/** One setting in an extension's section of `.pullup/config.json`; drives the generated settings form. */
export interface FieldSpec {
  /** Dotted path in the extension's section, for example `sensitivePaths.off`. */
  key: string;
  label: string;
  help: string;
  /** `list`: several strings; `map`: name → value pairs (for example GitHub login → person). */
  kind: "boolean" | "number" | "text" | "list" | "choice" | "map";
  /** For `choice` (one of) and `list` (any of, when the values are fixed). */
  options?: readonly string[];
  /** True when changing it from its default lets PullUp pass more easily. */
  loosens: boolean;
}

/** A file the host should read before the run: from the default branch (data the repository trusts) or the head commit. */
export interface FileRequest {
  from: "default" | "head";
  /** Exact paths or globs (`**` spans folders). */
  globs: string[];
}

/** Facts let one extension tell a later one something (for example "this change is switched off behind flag X"). */
export const factSchema = z.object({ kind: z.string().min(1).max(60) }).catchall(z.unknown());
export type Fact = z.infer<typeof factSchema>;

export const questionDraftSchema = z.object({
  /** Unique within this extension's questions for the run; the question id is `<extension>:<key>`. */
  key: z.string().regex(/^[A-Za-z0-9._-]{1,60}$/),
  prompt: z.string().min(1).max(500),
  summary: z.string().min(1).max(2000),
  evidence: z.array(z.object({ source: z.enum(["diff", "log", "report"]), where: z.string(), line: z.number().int().nullable(), text: z.string() })).max(50),
  councilMayPass: z.boolean(),
  severity: z.string().max(20).optional(),
  onNoAnswer: z.enum(NO_ANSWER_OPTIONS).optional(),
  /** Extra context for the council's seats (for example the threat a control protects). Sent fenced as data. */
  seatContext: z.string().max(4000).optional(),
  /** No relaxation may make this question easier (for example a rule that says a person decides). */
  neverRelax: z.boolean().optional(),
});
export type QuestionDraft = z.input<typeof questionDraftSchema>;

export const annotationSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().min(1),
  message: z.string().min(1).max(1000),
  level: z.enum(["notice", "warning", "failure"]).default("warning"),
});
export type Annotation = z.input<typeof annotationSchema>;

/** Ask the host to make one question easier, in one of its fixed ways. */
export const relaxRequestSchema = z.object({
  /** The target question's id, `<extension>:<key>`. */
  question: z.string().min(1),
  kind: z.enum(RELAX_KINDS),
  why: z.string().min(1).max(500),
});
export type RelaxRequest = z.infer<typeof relaxRequestSchema>;

export const detectionSchema = z.object({
  questions: z.array(questionDraftSchema).default([]),
  facts: z.array(factSchema).default([]),
  annotations: z.array(annotationSchema).default([]),
  relax: z.array(relaxRequestSchema).default([]),
});
export type Detection = z.input<typeof detectionSchema>;

/** Help for the reviewer that never changes the run's result. */
export const noteSchema = z.object({
  text: z.string().min(1).max(1000),
  /** Shown as a link on the run page and the check run: web addresses only. */
  link: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "a note's link must start with http:// or https://")
    .optional(),
});
export type Note = z.infer<typeof noteSchema>;

export interface FactReader {
  /** Facts of this kind published by the extensions this one `needs`, in run order. */
  get(kind: string): (Fact & { extension: string })[];
}

export interface RunContext<C> {
  /** This extension's own section of the config, parsed with its schema (without `mode`). */
  config: C;
  repo: { fullName: string };
  run: ParsedCiRun;
  /** The diff, parsed once by the host. */
  diff: DiffFile[];
  pull: PullInfo | null;
  /** Files from this extension's `reads` that were found. A missing file is "no data", never "passed". */
  files: ReadFile[];
  facts: FactReader;
  /** Answers to this extension's `screens`, checked by the host. Empty in `screens` itself. */
  screens: ScreenAnswer[];
  /** Settings every extension may read. */
  shared: { requiredWorkflows: string[]; knownFlakyTests: string[] };
  /** Milliseconds since 1970, passed in by the host (extensions never read the clock). */
  now: number;
}

export type AnyObjectSchema = z.ZodObject<any>;

export interface Extension<S extends AnyObjectSchema = AnyObjectSchema> {
  /** Also the config key and the question id prefix. Lowercase letters, digits and dashes. */
  id: string;
  /** Bumped with behavior; recorded on every output. */
  version: string;
  title: string;
  /** One plain sentence for the extensions list. */
  summary: string;
  /** `active` only for `core`: it runs unless switched off. Others are off unless listed, and Shadow when listed without a mode. */
  defaultMode?: "active";
  config: {
    /** The extension's section, without the host's `mode`, `shadowCouncil` and `maxQuestions`. Every field needs a default. */
    schema: S;
    fields: FieldSpec[];
  };
  /** Settings looser than the defaults, in plain words. Without it the host lists changed `loosens` fields. */
  loosenings?(config: z.infer<S>): string[];
  /** The relaxations this extension may propose, each switched on by one boolean `loosens` field. */
  relaxations?: { kind: RelaxKind; field: string }[];
  reads?(config: z.infer<S>): FileRequest[];
  /** Extensions whose facts this one reads; they run first. */
  needs?: string[];
  /** Cheap model questions for the host to ask before `detect` (see `screen.ts`). */
  screens?(ctx: RunContext<z.infer<S>>): ScreenRequest[];
  detect?(ctx: RunContext<z.infer<S>>): Detection;
  notes?(ctx: RunContext<z.infer<S>>): Note[];
  /** Who to ask about a question (WithAI people: member id, email or phone); null to leave it to the next extension or `ask.to`. */
  recipients?(ctx: RunContext<z.infer<S>>, question: Question): string[] | null;
  /** The WithAI person a GitHub login stands for (so their Pass / Fail button or `/pullup` comment counts as theirs), or null. */
  personForLogin?(config: z.infer<S>, login: string): string | null;
}

/** Typing helper: `export default defineExtension({ ... })`. */
export function defineExtension<S extends AnyObjectSchema>(extension: Extension<S>): Extension<S> {
  return extension;
}
