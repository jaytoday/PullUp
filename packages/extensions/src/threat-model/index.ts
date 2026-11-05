import { type Annotation, changedLines, definesSymbol, type DiffFile, defineExtension, type Evidence, type Fact, inSymbol, lineNumber, matchesAny, type Note, type QuestionDraft } from "@pullup/sdk";
import { z } from "zod";
import { parseThreatModel, type Threat, type ThreatModel } from "./parse";

/**
 * Checks every change against the repository's threat model (see `parse.ts`
 * for the layout). Plain code, no model calls:
 * - a change inside the code a threat's control lives in asks whether it
 *   weakens that control (a person decides, by default);
 * - a change that deletes or renames what the code map points at asks whether
 *   the control moved;
 * - a new file or line matching an entry point that no threat covers asks
 *   whether it needs a threat entry;
 * - a change to the threat model that removes a threat, moves one out of
 *   scope or drops an operator contract item is a loosening question.
 * The threat model is read from the default branch, so a pull request cannot
 * weaken the model it is checked against.
 */

const schema = z.object({
  /** Where the threat model lives (on the default branch). SECURITY.md works too when it has the four sections. */
  path: z.string().min(1).default("THREATS.md"),
  /** Whether the council may pass "does this weaken the control" questions without a person. */
  controlsCouncilMayPass: z.boolean().default(false),
});
type ThreatConfig = z.infer<typeof schema>;

const MAX_EVIDENCE = 12;

const evidenceOf = (file: DiffFile, lines = changedLines(file)): Evidence[] =>
  lines.slice(0, MAX_EVIDENCE).map((l) => ({ source: "diff", where: file.path, line: lineNumber(l), text: l.text }));

const describe = (t: Threat) => `${t.id} (${t.threat})`;
const seatContext = (threats: Threat[]) =>
  threats.map((t) => `Threat ${t.id}: ${t.threat}\nControl: ${t.control}\nCode: ${t.code.map((c) => `${c.path}${c.symbol ? ` → ${c.symbol}` : ""}`).join("; ")}`).join("\n\n");

/** The changed lines of `file` that fall inside a threat's mapped code. */
function touchedLines(threat: Threat, file: DiffFile) {
  return threat.code.flatMap((ref) => {
    if (ref.path !== file.path || file.status !== "modified") return [];
    return changedLines(file).filter((l) => !ref.symbol || inSymbol(l, ref.symbol));
  });
}

/** Mapped code this change removes: a deleted or renamed file, or a function whose definition is removed and not added back in the same file. */
function drift(threat: Threat, files: DiffFile[]): { file: DiffFile; why: string }[] {
  const out: { file: DiffFile; why: string }[] = [];
  for (const ref of threat.code) {
    const deleted = files.find((f) => f.status === "deleted" && f.path === ref.path);
    const renamed = files.find((f) => f.status !== "deleted" && f.oldPath === ref.path && f.path !== ref.path);
    if (deleted) out.push({ file: deleted, why: `${ref.path} is deleted` });
    else if (renamed) out.push({ file: renamed, why: `${ref.path} is renamed to ${renamed.path}` });
    else if (ref.symbol) {
      const file = files.find((f) => f.path === ref.path && f.status === "modified");
      const removed = file?.lines.some((l) => l.kind === "remove" && definesSymbol(l.text, ref.symbol!));
      const added = file?.lines.some((l) => l.kind === "add" && definesSymbol(l.text, ref.symbol!));
      if (file && removed && !added) out.push({ file, why: `${ref.symbol} is removed from ${ref.path}` });
    }
  }
  return out;
}

function entryPoints(model: ThreatModel, files: DiffFile[]): { file: DiffFile; lines: DiffFile["lines"]; pattern: string }[] {
  const mapped = new Set(model.inScope.flatMap((t) => t.code.map((c) => c.path)));
  const hits: { file: DiffFile; lines: DiffFile["lines"]; pattern: string }[] = [];
  for (const f of files) {
    if (f.status === "deleted" || mapped.has(f.path)) continue;
    const glob = f.status === "added" ? matchesAny(f.path, model.entryPoints.globs) : null;
    if (glob) {
      hits.push({ file: f, lines: changedLines(f).slice(0, 2), pattern: glob });
      continue;
    }
    for (const pattern of model.entryPoints.code) {
      const lines = f.lines.filter((l) => l.kind === "add" && l.text.includes(pattern));
      if (lines.length) {
        hits.push({ file: f, lines, pattern });
        break;
      }
    }
  }
  return hits;
}

/** What a change to the threat model itself loosens: removed threats, threats moved out of scope, dropped contract items. */
function weakened(before: ThreatModel, after: ThreatModel | null): string[] {
  if (!after) return ["the threat model file is deleted"];
  const out: string[] = [];
  if (after.problems.length && !before.problems.length) out.push(`the threat model can no longer be read: ${after.problems[0]}`);
  for (const t of before.inScope) {
    if (after.inScope.some((x) => x.id === t.id)) continue;
    const moved = after.outOfScope.find((o) => o.name.toLowerCase().includes(t.threat.toLowerCase()) || o.name.includes(t.id));
    out.push(moved ? `${describe(t)} is moved out of scope` : `${describe(t)} is removed`);
  }
  for (const c of before.contract) if (!after.contract.some((x) => x.key === c.key)) out.push(`operator contract item \`${c.key}\` is removed`);
  return out;
}

export default defineExtension({
  id: "threat-model",
  version: "1.0.0",
  title: "Threat model",
  summary: "Checks each change against the repository's threat model: controls touched, code map drift, new entry points, and edits that weaken the model.",
  config: {
    schema,
    fields: [
      { key: "path", label: "Threat model file", help: "Read from the default branch. THREATS.md, or SECURITY.md with the same four sections.", kind: "text", loosens: false },
      { key: "controlsCouncilMayPass", label: "The council may pass changes to a control alone", help: "Off by default: a person decides whether a change weakens a control.", kind: "boolean", loosens: true },
    ],
  },
  reads: (config: ThreatConfig) => [
    { from: "default", globs: [config.path] },
    { from: "head", globs: [config.path] },
  ],
  detect({ config, diff, files }) {
    const base = files.find((f) => f.from === "default");
    if (!base) return {};
    const model = parseThreatModel(base.text);
    const questions: QuestionDraft[] = [];
    const facts: Fact[] = [];
    const annotations: Annotation[] = [];

    const edited = diff.find((f) => f.path === config.path || f.oldPath === config.path);
    if (edited) {
      const head = edited.status === "deleted" || edited.path !== config.path ? null : files.find((f) => f.from === "head");
      const lost = weakened(model, head ? parseThreatModel(head.text) : null);
      if (lost.length) {
        questions.push({
          key: "model-weakened",
          prompt: "This change weakens the threat model. Is that intended and agreed?",
          summary: `Threat model: ${lost.join("; ")}.`,
          evidence: evidenceOf(edited, edited.lines.filter((l) => l.kind === "remove")),
          councilMayPass: false,
        });
      }
    }
    if (model.problems.length) return { questions };

    for (const threat of model.inScope) {
      const moved = drift(threat, diff);
      if (moved.length) {
        questions.push({
          key: `drift-${threat.id}`,
          prompt: `The threat model points at code this change removes. Was the control for ${describe(threat)} moved, and is the map updated?`,
          summary: `Code map drift for ${threat.id}: ${moved.map((m) => m.why).join("; ")}.`,
          evidence: moved.flatMap((m) => evidenceOf(m.file, m.file.lines.filter((l) => l.kind === "remove").slice(0, 4))).slice(0, MAX_EVIDENCE),
          councilMayPass: false,
          seatContext: seatContext([threat]),
        });
        continue;
      }
      const touched = diff.flatMap((f) => {
        const lines = touchedLines(threat, f);
        return lines.length ? [{ file: f, lines }] : [];
      });
      if (!touched.length) continue;
      facts.push({ kind: "threat-touched", id: threat.id });
      for (const t of touched) {
        const first = t.lines.find((l) => l.newLine !== null);
        if (first?.newLine) annotations.push({ path: t.file.path, line: first.newLine, message: `This code implements the control for ${describe(threat)}: ${threat.control}`, level: "warning" });
      }
      questions.push({
        key: threat.id,
        prompt: `Does this change weaken the control for ${describe(threat)}?`,
        summary: `Control for ${describe(threat)} touched in ${touched.map((t) => t.file.path).join(", ")}.`,
        evidence: touched.flatMap((t) => evidenceOf(t.file, t.lines)).slice(0, MAX_EVIDENCE),
        councilMayPass: config.controlsCouncilMayPass,
        seatContext: seatContext([threat]),
      });
    }

    const ways = entryPoints(model, diff);
    if (ways.length) {
      questions.push({
        key: "entry-point",
        prompt: "This adds a new way into the system that no threat in the threat model covers. Does it need a threat entry?",
        summary: `New entry points: ${ways.map((w) => `${w.file.path} (${w.pattern})`).join(", ")}.`,
        evidence: ways.flatMap((w) => evidenceOf(w.file, w.lines.slice(0, 3))).slice(0, MAX_EVIDENCE),
        councilMayPass: true,
        seatContext: `Threats the model covers:\n${model.inScope.map((t) => `- ${describe(t)}: ${t.control}`).join("\n")}`.slice(0, 4000),
      });
    }
    return { questions, facts, annotations };
  },
  notes({ config, files }) {
    const base = files.find((f) => f.from === "default");
    if (!base) return [{ text: `No ${config.path} on the default branch, so the threat model checks did not run.` }];
    const problems = parseThreatModel(base.text).problems;
    return problems.length ? [{ text: `The threat model (${config.path}) could not be read, so its checks did not run: ${problems.slice(0, 3).join(" ")}` }] : ([] as Note[]);
  },
});

export { parseThreatModel, type ThreatModel } from "./parse";

/**
 * The code map against the files of one commit (the daily check on the default
 * branch, and PullUp's own test): each mapped file must exist and define the
 * mapped function. Returns one line per problem.
 */
export function codeMapProblems(model: ThreatModel, read: (path: string) => string | null): string[] {
  const out: string[] = [];
  for (const t of model.inScope) {
    for (const ref of t.code) {
      const text = read(ref.path);
      if (text === null) out.push(`${t.id}: ${ref.path} does not exist.`);
      else if (ref.symbol && !text.split("\n").some((l) => definesSymbol(l, ref.symbol!))) out.push(`${t.id}: ${ref.path} does not define ${ref.symbol}.`);
    }
  }
  return out;
}
