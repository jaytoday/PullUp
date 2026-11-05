import { defineExtension, type Evidence, type Note, type QuestionDraft, type ReadFile, type RunContext, type ScreenAnswer, type ScreenRequest } from "@pullup/sdk";
import { z } from "zod";
import { judgeViolation, type LintRule, parseLintRule, ruleApplies } from "./rules";

/**
 * The repository's own rules, written as Gallant lint rules (Markdown with
 * YAML frontmatter) under `.pullup/rules/` on the default branch. For each
 * changed file a rule applies to, the host asks one cheap screen ("does this
 * change break the rule?"); a rule that fails, with a quote that really is in
 * the change, raises one question for the council. A file that could not be
 * checked is a note, and with `failClosed` (the default) a question too:
 * nothing checked is not a pass.
 */

const schema = z.object({
  /** Folder of rule files on the default branch. */
  dir: z.string().min(1).default(".pullup/rules"),
  /** Raise a question when a file could not be checked (the call failed, or the run's screen limit was reached). */
  failClosed: z.boolean().default(true),
  /** Whether the council may pass a failing rule's question alone. A rule can only make this stricter (`pullupCouncilMayPass: false`). */
  councilMayPass: z.boolean().default(true),
});
type RulesConfig = z.infer<typeof schema>;

const MAX_EVIDENCE = 12;

/** The rules in the folder, and the files that are not usable rules (with why). Hidden files and non-Markdown files are skipped, as in Gallant. */
export function loadRules(files: ReadFile[], dir: string): { rules: LintRule[]; problems: string[] } {
  const rules: LintRule[] = [];
  const problems: string[] = [];
  for (const f of files.filter((x) => x.from === "default").sort((a, b) => a.path.localeCompare(b.path))) {
    const path = f.path.slice(dir.replace(/\/+$/, "").length + 1);
    if (!path.endsWith(".md") || path.split("/").some((part) => part.startsWith("."))) continue;
    const parsed = parseLintRule(path, f.text);
    if (parsed.ok) rules.push(parsed.rule);
    else problems.push(`${path} ${parsed.problem.message}`);
  }
  return { rules, problems };
}

/** Every (rule, changed file) pair to screen, in a fixed order, with its screen key. */
function pairs(ctx: RunContext<RulesConfig>) {
  const { rules } = loadRules(ctx.files, ctx.config.dir);
  const changed = ctx.diff.filter((f) => f.status !== "deleted" && f.lines.some((l) => l.kind === "add"));
  return rules.flatMap((rule) =>
    changed
      .map((file, i) => ({ rule, file: file.path, key: `${rule.key}:${i}` }))
      .filter((p) => ruleApplies(p.rule, p.file)),
  );
}

function screenFor(rule: LintRule, file: string, key: string): ScreenRequest {
  if (rule.type === "noul") {
    return { key, file, question: `Does the change to ${file} break this rule? "yes" means it breaks it.`, guidance: rule.body, options: ["yes", "no"] };
  }
  const options = rule.type === "choice" ? Object.keys(rule.options!) : [...rule.levels!];
  const described = rule.type === "choice" ? Object.entries(rule.options!).map(([o, d]) => `- ${o}: ${d}`).join("\n") : `Levels, lowest first: ${rule.levels!.join(", ")}`;
  return {
    key,
    file,
    question: `Judge the change to ${file} by this rule and pick one answer.`,
    guidance: `${rule.body}\n\n${described}`,
    options,
    needsQuote: rule.violation ? Object.keys(rule.violation.if) : [],
  };
}

/** Whether a checked answer breaks the rule, as Gallant decides (strictly above the threshold). */
export function breaks(rule: LintRule, answer: ScreenAnswer): { fails: boolean; reason: string } {
  if (answer.status !== "answered" || answer.result === null) return { fails: false, reason: "not checked" };
  if (rule.type === "noul") {
    const p = answer.result === "yes" ? answer.confidence : 1 - answer.confidence;
    return p > rule.minConfidence ? { fails: true, reason: `yes ${p.toFixed(2)} > ${rule.minConfidence}` } : { fails: false, reason: `yes ${p.toFixed(2)}` };
  }
  if (!rule.violation) return { fails: false, reason: "the rule has no violation clause" };
  return judgeViolation(rule.violation, { [answer.result]: answer.confidence });
}

export default defineExtension({
  id: "repo-rules",
  version: "1.0.0",
  title: "Repository rules",
  summary: "Checks changed files against the repository's own rules (Gallant lint rule files in .pullup/rules), with a cheap model screen per file.",
  config: {
    schema,
    fields: [
      { key: "dir", label: "Rules folder", help: "Markdown rule files in Gallant's format, read from the default branch.", kind: "text", loosens: false },
      { key: "failClosed", label: "Ask when a file could not be checked", help: "On by default: nothing checked is not a pass.", kind: "boolean", loosens: true },
      { key: "councilMayPass", label: "The council may pass a failing rule alone", help: "A rule can make itself stricter with pullupCouncilMayPass: false.", kind: "boolean", loosens: false },
    ],
  },
  reads: (config) => [{ from: "default", globs: [`${config.dir}/**/*.md`] }],
  screens(ctx) {
    return pairs(ctx).map((p) => screenFor(p.rule, p.file, p.key));
  },
  detect(ctx) {
    const answers = new Map(ctx.screens.map((a) => [a.key, a]));
    const questions: QuestionDraft[] = [];
    const notChecked: string[] = [];
    const failing = new Map<string, { rule: LintRule; files: string[]; reasons: string[]; evidence: Evidence[] }>();
    for (const p of pairs(ctx)) {
      const answer = answers.get(p.key);
      if (!answer || answer.status !== "answered") {
        notChecked.push(`${p.rule.path} on ${p.file}${answer?.why ? ` (${answer.why})` : ""}`);
        continue;
      }
      const verdict = breaks(p.rule, answer);
      if (!verdict.fails) continue;
      const entry = failing.get(p.rule.key) ?? { rule: p.rule, files: [], reasons: [], evidence: [] };
      entry.files.push(p.file);
      entry.reasons.push(answer.reason.slice(0, 300));
      entry.evidence.push(...answer.quotes.map((q): Evidence => ({ source: "diff", where: q.file, line: q.line, text: q.text })));
      failing.set(p.rule.key, entry);
    }
    for (const f of failing.values()) {
      questions.push({
        key: f.rule.key,
        prompt: `The repository's rule ${f.rule.path} looks broken by this change. Should the run pass anyway?`,
        summary: `Rule ${f.rule.path} fails in ${f.files.join(", ")}: ${f.reasons[0]}`.slice(0, 2000),
        evidence: f.evidence.slice(0, MAX_EVIDENCE),
        councilMayPass: ctx.config.councilMayPass && f.rule.councilMayPass,
        ...(f.rule.level ? { severity: f.rule.level.toUpperCase() } : {}),
        seatContext: `The repository's rule (${f.rule.path}):\n${f.rule.body}`.slice(0, 4000),
      });
    }
    if (notChecked.length && ctx.config.failClosed) {
      questions.push({
        key: "not-checked",
        prompt: "Some changed files could not be checked against the repository's rules. Do they follow them?",
        summary: `Not checked: ${notChecked.join("; ")}.`.slice(0, 2000),
        evidence: [],
        councilMayPass: ctx.config.councilMayPass,
      });
    }
    return { questions };
  },
  notes(ctx) {
    const { rules, problems } = loadRules(ctx.files, ctx.config.dir);
    const notes: Note[] = [];
    if (!rules.length && !problems.length) notes.push({ text: `No rule files in ${ctx.config.dir} on the default branch.` });
    for (const p of problems.slice(0, 5)) notes.push({ text: `Rule file ${p}; it never runs until fixed.` });
    const skipped = ctx.screens.filter((a) => a.status !== "answered");
    if (skipped.length) notes.push({ text: `${skipped.length} rule check(s) could not run: ${[...new Set(skipped.map((a) => a.why))].join("; ")}.`.slice(0, 1000) });
    return notes;
  },
});
