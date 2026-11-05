import { allExtensions, extensionById } from "@pullup/extensions";
import {
  type Annotation,
  ciRunSchema,
  annotationSchema,
  type Detection,
  detectionSchema,
  type Extension,
  type Fact,
  type FileRequest,
  matchesAny,
  type Note,
  noteSchema,
  type ParsedCiRun,
  parseDiff,
  type Question,
  type QuestionDraft,
  questionDraftSchema,
  type RelaxKind,
  type RunContext,
} from "@pullup/sdk";
import { z } from "zod";
import { canonicalJson, sha256 } from "./canonical";
import { type Config, enabledExtensions, type ExtensionSettings } from "./config";

/**
 * The extension host. It runs every enabled extension over a run, in order,
 * and turns what they return into questions, facts, notes and annotations.
 * Rules it keeps so no extension has to:
 * - extensions see frozen copies of the run, so they cannot change what others see;
 * - extensions only add work: their output is parsed with the SDK's schemas,
 *   so anything else they return (a "pass", another extension's question) is ignored;
 * - an extension that throws or returns a bad shape raises a question only a
 *   person may pass ("nothing checked is not a pass");
 * - Shadow questions are marked and never count (see `combine`);
 * - the only way a question gets easier is a relaxation from the fixed list
 *   below, applied only when the proposing extension is Active, a `loosens`
 *   setting allows it, it `needs` the target's extension, and the target is
 *   not on the never-relax list;
 * - too many questions are folded or sent straight to a person, never dropped.
 */

export interface ExtensionOutput {
  id: string;
  version: string;
  mode: ExtensionSettings["mode"];
  questions: string[];
  facts: number;
  notes: number;
  annotations: number;
  /** Hash of everything the extension returned, so a run can be explained and replayed. */
  outputHash: string;
  error: string | null;
}

export interface RelaxRecord {
  extension: string;
  question: string;
  kind: RelaxKind;
  why: string;
  applied: boolean;
  refused: string | null;
}

export type Stamped<T> = T & { extension: string };

export interface HostResult {
  questions: Question[];
  facts: Stamped<Fact>[];
  notes: Stamped<Note>[];
  annotations: Stamped<z.infer<typeof annotationSchema>>[];
  relaxations: RelaxRecord[];
  outputs: ExtensionOutput[];
  compositionHash: string;
}

export interface HostOptions {
  /** Milliseconds since 1970; extensions never read the clock themselves. */
  now: number;
  /** Run only these extensions (`pullup check --only`). */
  only?: string[];
}

/** Question keys the host uses itself. */
const ERROR_KEY = "extension-error";
const FOLD_KEY = "more";

/**
 * Questions no relaxation may touch, whatever the config says: threat model
 * questions (except a new entry point), turning a flag on, and an extension
 * that failed.
 */
export function neverRelaxed(question: Question): string | null {
  if (question.neverRelax) return "the question says a person decides";
  if (question.key === ERROR_KEY) return "an extension that failed is never relaxed";
  if (question.extension === "threat-model" && !question.key.startsWith("entry-point")) return "threat model questions are never relaxed";
  if (question.id === "inert:flag-activation") return "turning a flag on is never relaxed";
  return null;
}

/** What one extension may see of the run. */
function contextFor(extension: Extension, settings: ExtensionSettings, run: ParsedCiRun, config: Config, diff: RunContext<unknown>["diff"], facts: Stamped<Fact>[], now: number): RunContext<Record<string, unknown>> {
  const requests = extension.reads?.(settings.config) ?? [];
  const needs = new Set(extension.needs ?? []);
  return {
    config: settings.config,
    repo: { fullName: run.repo },
    run,
    diff,
    pull: run.pull,
    files: run.files.filter((f) => requests.some((r) => r.from === f.from && matchesAny(f.path, r.globs))),
    facts: { get: (kind) => facts.filter((f) => f.kind === kind && needs.has(f.extension)) },
    shared: { requiredWorkflows: config.requiredWorkflows, knownFlakyTests: config.flaky.knownTests },
    now,
  };
}

/** Every file request of the enabled extensions, so collection can read them all in one pass. */
export function fileRequests(config: Config): FileRequest[] {
  return enabledExtensions(config).flatMap((id) => extensionById(id)!.reads?.(config.extensions[id]!.config) ?? []);
}

/** A hash of every enabled extension's id, version, mode and settings: two runs with the same hash ran the same checks. */
export function compositionHash(config: Config): string {
  return sha256(
    canonicalJson(
      enabledExtensions(config).map((id) => {
        const s = config.extensions[id]!;
        return { id, version: extensionById(id)!.version, mode: s.mode, shadowCouncil: s.shadowCouncil, maxQuestions: s.maxQuestions, config: sha256(canonicalJson(s.config)) };
      }),
    ),
  );
}

function errorDraft(extension: Extension, message: string): QuestionDraft {
  return {
    key: ERROR_KEY,
    prompt: `The ${extension.title} check could not finish. Should this run pass anyway?`,
    summary: `${extension.title} (${extension.id}) failed: ${message.slice(0, 300)}`,
    evidence: [],
    councilMayPass: false,
    neverRelax: true,
  };
}

type ParsedDraft = z.infer<typeof detectionSchema>["questions"][number];

/** Unique keys, and at most `max` questions: the rest are folded into one question that lists them. */
function capDrafts(extension: Extension, drafts: ParsedDraft[], max: number): ParsedDraft[] {
  const seen = new Set<string>();
  const unique = drafts.map((d) => {
    let key = d.key;
    for (let n = 2; seen.has(key); n++) key = `${d.key}-${n}`;
    seen.add(key);
    return { ...d, key };
  });
  if (unique.length <= max) return unique;
  const kept = unique.slice(0, max - 1);
  const folded = unique.slice(max - 1);
  return [
    ...kept,
    {
      key: FOLD_KEY,
      prompt: `${extension.title} found ${folded.length} more things to check. Should this run pass?`,
      summary: folded.map((d) => d.summary).join(" ").slice(0, 2000),
      evidence: folded.flatMap((d) => d.evidence).slice(0, 12),
      councilMayPass: folded.every((d) => d.councilMayPass),
      neverRelax: folded.some((d) => d.neverRelax || d.key === ERROR_KEY) || undefined,
      seatContext: folded.map((d) => d.seatContext).filter(Boolean).join("\n\n").slice(0, 4000) || undefined,
    },
  ];
}

const withoutUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** A frozen deep copy: what the host shares with extensions, so one cannot change what the next one sees. */
function frozenCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (v: unknown) => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v);
      Object.values(v).forEach(freeze);
    }
  };
  freeze(copy);
  return copy;
}

export function runExtensions(original: ParsedCiRun, config: Config, options: HostOptions): HostResult {
  const ids = enabledExtensions(config).filter((id) => !options.only || options.only.includes(id));
  const run = frozenCopy(ciRunSchema.parse(original));
  const diff = frozenCopy(parseDiff(run.diff));
  const result: HostResult = { questions: [], facts: [], notes: [], annotations: [], relaxations: [], outputs: [], compositionHash: compositionHash(config) };
  const proposals: { extension: string; question: string; kind: RelaxKind; why: string }[] = [];
  const contexts = new Map<string, RunContext<Record<string, unknown>>>();

  for (const id of ids) {
    const extension = extensionById(id)!;
    const settings = config.extensions[id]!;
    const ctx = contextFor(extension, settings, run, config, diff, result.facts, options.now);
    contexts.set(id, ctx);
    let detection: z.infer<typeof detectionSchema>;
    let error: string | null = null;
    try {
      const raw: Detection = extension.detect?.(ctx) ?? {};
      const parsed = detectionSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`returned a bad shape: ${parsed.error.issues[0]?.message ?? "unknown"} at ${parsed.error.issues[0]?.path.join(".")}`);
      detection = parsed.data;
    } catch (err) {
      error = (err as Error).message;
      detection = { questions: [questionDraftSchema.parse(errorDraft(extension, error))], facts: [], annotations: [], relax: [] };
    }
    const drafts = capDrafts(extension, detection.questions, settings.maxQuestions);
    const questions = drafts.map(
      (d): Question =>
        withoutUndefined({
          id: `${id}:${d.key}`,
          extension: id,
          key: d.key,
          councilMayPass: d.councilMayPass,
          prompt: d.prompt,
          summary: d.summary,
          evidence: d.evidence,
          shadow: settings.mode === "shadow",
          severity: d.severity,
          onNoAnswer: d.onNoAnswer,
          seatContext: d.seatContext,
          neverRelax: d.neverRelax,
        }),
    );
    result.questions.push(...questions);
    result.facts.push(...detection.facts.map((f) => ({ ...f, extension: id })));
    result.annotations.push(...detection.annotations.map((a) => ({ ...a, extension: id })));
    proposals.push(...detection.relax.map((r) => ({ ...r, extension: id })));
    result.outputs.push({
      id,
      version: extension.version,
      mode: settings.mode,
      questions: questions.map((q) => q.id),
      facts: detection.facts.length,
      notes: 0,
      annotations: detection.annotations.length,
      outputHash: sha256(canonicalJson(detection)),
      error,
    });
  }

  // Notes come after every detection, so they can read every fact they need; they never feed back into questions.
  for (const id of ids) {
    const extension = extensionById(id)!;
    if (!extension.notes) continue;
    const output = result.outputs.find((o) => o.id === id)!;
    try {
      const notes = z.array(noteSchema).parse(extension.notes(contexts.get(id)!));
      result.notes.push(...notes.map((n) => ({ ...n, extension: id })));
      output.notes = notes.length;
      output.outputHash = sha256(output.outputHash, canonicalJson(notes));
    } catch (err) {
      result.notes.push({ text: `${extension.title} could not write its notes: ${(err as Error).message.slice(0, 200)}`, extension: id });
    }
  }

  for (const p of proposals) result.relaxations.push(relax(p, result.questions, config));

  // Who to ask: the first extension (in run order) that names people for the question.
  for (const q of result.questions) {
    for (const id of ids) {
      const extension = extensionById(id)!;
      let people: string[] | null = null;
      try {
        people = extension.recipients?.(contexts.get(id)!, q) ?? null;
      } catch {
        people = null;
      }
      const valid = (people ?? []).filter((p) => typeof p === "string" && p.trim()).slice(0, 5);
      if (valid.length) {
        q.askTo = valid;
        break;
      }
    }
  }

  applyCouncilCap(result.questions, config);
  result.annotations = result.annotations.slice(0, 50);
  return result;
}

/** Apply one proposed relaxation, or record why not. */
function relax(p: { extension: string; question: string; kind: RelaxKind; why: string }, questions: Question[], config: Config): RelaxRecord {
  const base = { ...p, applied: false };
  const refuse = (why: string): RelaxRecord => ({ ...base, refused: why });
  const proposer = extensionById(p.extension)!;
  const target = questions.find((q) => q.id === p.question);
  if (!target) return refuse("no such question in this run");
  if (config.extensions[p.extension]?.mode !== "active") return refuse(`${p.extension} is not in Active mode`);
  const allowed = proposer.relaxations?.find((r) => r.kind === p.kind);
  if (!allowed) return refuse(`${p.extension} does not offer this relaxation`);
  if (config.extensions[p.extension]!.config[allowed.field] !== true) return refuse(`the setting ${p.extension}.${allowed.field} is off`);
  const never = neverRelaxed(target);
  if (never) return refuse(never);
  if (target.extension !== p.extension && !(proposer.needs ?? []).includes(target.extension)) return refuse(`${p.extension} does not list ${target.extension} in its needs`);
  if (p.kind === "council-may-pass") {
    if (target.councilMayPass) return refuse("the council may already pass it");
    target.councilMayPass = true;
  }
  target.relaxedBy = { extension: p.extension, kind: p.kind, why: p.why };
  return { ...base, applied: true, refused: null };
}

/**
 * At most `council.maxQuestionsPerRun` questions go to the council: Active
 * before Shadow, questions a person must decide first. The others go straight
 * to a person (Active) or are only shown (Shadow). Shadow questions of an
 * extension with `shadowCouncil: false` never go to the council.
 */
function applyCouncilCap(questions: Question[], config: Config): void {
  const wants = questions.filter((q) => !q.shadow || config.extensions[q.extension]?.shadowCouncil);
  for (const q of questions) if (!wants.includes(q)) q.skipCouncil = true;
  const rank = (q: Question) => (q.shadow ? 2 : 0) + (q.councilMayPass ? 1 : 0);
  const ordered = [...wants].sort((a, b) => rank(a) - rank(b));
  for (const q of ordered.slice(config.council.maxQuestionsPerRun)) q.skipCouncil = true;
}

/** Bundled extensions as the API and the dashboard describe them. */
export function describeExtensions() {
  return allExtensions().map((e) => ({
    id: e.id,
    version: e.version,
    title: e.title,
    summary: e.summary,
    defaultMode: e.defaultMode ?? "off",
    needs: e.needs ?? [],
    fields: e.config.fields,
    defaults: e.config.schema.parse({}),
    configSchema: z.toJSONSchema(e.config.schema, { io: "input" }),
  }));
}

export type { Annotation };

/** The questions a run raises (shorthand for tests and tools). */
export function findQuestions(run: ParsedCiRun, config: Config, now = 0): Question[] {
  return runExtensions(run, config, { now }).questions;
}
