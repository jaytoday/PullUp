import { type DiffFile, type DiffLine, defineExtension, type Evidence, matchesAny, type QuestionDraft, type RunContext, type ScreenRequest, TEST_GLOBS } from "@pullup/sdk";
import { z } from "zod";

/**
 * The inert check: is this change switched off behind a feature flag? The
 * author claims it (a `pullup:inert` label, or a line `PullUp-Inert: flag=<name>`
 * in the pull request's description); PullUp tries to disprove it, since
 * "inert" argues a change is safer and model answers may only raise risk.
 *
 * 1. Code disqualifiers: risky kinds of file, a flag added or changed to on,
 *    startup patterns, new code under a negated gate (`if (!isEnabled(...))`,
 *    the case a model alone missed in testing; existing code newly wrapped in
 *    such a gate, a kill switch, is fine), and new code in a file with no flag
 *    check at all.
 * 2. One screen per changed code file: "with every flag off, does anything
 *    differ?" ("yes" means risk). A "yes" above `maxP` disproves the claim.
 * 3. The result is a fact (`verified`, `disproved` or `unclear`) and a note.
 *    It never makes a run pass more easily by itself: the one loosening,
 *    letting the council pass a sensitive path question when the claim is
 *    verified, is the host's `council-may-pass` relaxation, switched on by
 *    `relaxSensitiveWhenInert` (off by default).
 *
 * Separately, whether or not anything is claimed, a change that turns a flag
 * on (in a flag file or a rollout file) is a question only a person may pass.
 *
 * Built from the inert check plan and its step-0 test (code/pullup).
 */

const regexList = z.array(z.string().refine((s) => {
  try {
    new RegExp(s);
    return true;
  } catch {
    return false;
  }
}, "not a valid regular expression"));

const schema = z.object({
  /** The pull request label that claims the change is inert. */
  label: z.string().min(1).default("pullup:inert"),
  /** Files that define flags and their defaults. */
  flagFiles: z.array(z.string().min(1)).default(["**/flags.ts", "**/flags.js", "**/flags.json", "**/flags.yaml", "**/flags.yml", "**/feature-flags.*"]),
  /** Files whose any change rolls a flag out (for example per-environment overrides). Every change to them is a flag activation. */
  rolloutFiles: z.array(z.string().min(1)).default([]),
  /** Regular expressions for a flag check in code. */
  gatePatterns: regexList.default(["isEnabled\\(", "useFlag\\(", "isFeatureEnabled\\(", "flags\\.[A-Za-z_]"]),
  /** Regular expressions for code that registers something at startup (routes, jobs). An added line matching one disproves the claim. */
  startupPatterns: regexList.default([]),
  /** A screen's probability of "yes, something differs with flags off" above this disproves the claim. Deliberately strict. */
  maxP: z.number().min(0).max(1).default(0.3),
  /** A disproved claim asks a person (the author said one thing, the code says another). Off: a note only. */
  askWhenDisproved: z.boolean().default(false),
  /** When the claim is verified, the council may pass a sensitive path question alone. This loosens PullUp. */
  relaxSensitiveWhenInert: z.boolean().default(false),
});
type InertConfig = z.infer<typeof schema>;

/** Kinds of file that have effects without any code running through a flag. */
const RISKY: { label: string; globs: string[] }[] = [
  { label: "a database migration", globs: ["**/migrations/**", "**/migrate/**", "**/*.sql"] },
  { label: "a dependency change", globs: ["**/package.json", "**/pnpm-lock.yaml", "**/package-lock.json", "**/yarn.lock", "**/go.mod", "**/go.sum", "**/requirements*.txt", "**/pyproject.toml", "**/Cargo.toml", "**/Cargo.lock", "**/Gemfile", "**/Gemfile.lock"] },
  { label: "a CI change", globs: [".github/workflows/**", ".github/actions/**"] },
  { label: "an infrastructure change", globs: ["**/*.tf", "infra/**", "**/Dockerfile", "**/docker-compose*", "**/k8s/**", "**/helm/**"] },
];
const DOC_GLOBS = ["**/*.md", "**/*.mdx", "**/*.txt", "docs/**"];
const OFF = /\b(?:false|off|disabled)\b|[:=]\s*0\b/i;
const ON = /\b(?:true|on|enabled)\b|[:=]\s*1\b/i;
const NAME = /^[A-Za-z0-9._-]{1,80}$/;
const MAX_EVIDENCE = 12;

/** The flags claimed: from `PullUp-Inert: flag=<name>` lines, or `[]` with just the label; null when nothing is claimed. */
export function claimedFlags(pull: RunContext<InertConfig>["pull"], label: string): string[] | null {
  if (!pull) return null;
  const flags = [...pull.body.matchAll(/^\s*PullUp-Inert:\s*(?:flag=)?\s*([^\s,]+)/gim)].map((m) => m[1]!).filter((f) => NAME.test(f));
  if (flags.length) return [...new Set(flags)];
  return pull.labels.includes(label) ? [] : null;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const code = (f: DiffFile) => !matchesAny(f.path, TEST_GLOBS) && !matchesAny(f.path, DOC_GLOBS);
const ev = (f: DiffFile, l: DiffLine): Evidence => ({ source: "diff", where: f.path, line: l.newLine ?? l.oldLine, text: l.text });
const meaningful = (l: DiffLine) => l.kind === "add" && l.text.trim() !== "" && !/^\s*(?:\/\/|\/\*|\*|#)/.test(l.text);

/** A top-level line that only declares something (runs nothing until called). */
const DECLARATION = /^(?:import\b|export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum|\{)|function\b|async\s+function\b|const\b|let\b|class\b|interface\b|type\b|enum\b|[}\])]|\/\/|\/\*|\*|$)/;

interface Problem {
  reason: string;
  evidence: Evidence[];
}

/**
 * The statements a negated gate on line `i` guards: the rest of the same line
 * (`if (!isEnabled(x)) doIt();`), or the added lines of its `{ … }` block.
 */
function gatedBody(lines: DiffLine[], i: number, negated: RegExp): string[] {
  const line = lines[i]!.text;
  const rest = line.slice(line.search(negated)).replace(/^[^)]*\)\s*\)?/, "").trim();
  if (rest && rest !== "{") return [norm(rest)];
  const body: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (l.kind !== "add") continue;
    if (/^\s*}/.test(l.text)) break;
    if (l.text.trim()) body.push(norm(l.text));
  }
  return body;
}

/** Everything code alone can say against the claim. */
export function disqualifiers(ctx: RunContext<InertConfig>): Problem[] {
  const { config, diff } = ctx;
  const gate = new RegExp(config.gatePatterns.join("|"));
  const negated = new RegExp(`!\\s*(?:${config.gatePatterns.join("|")})`);
  const startup = config.startupPatterns.map((p) => new RegExp(p));
  const out: Problem[] = [];
  for (const f of diff) {
    const changed = f.lines.filter((l) => l.kind !== "context");
    const first = changed[0];
    const risky = RISKY.find((r) => matchesAny(f.path, r.globs) || (f.oldPath && matchesAny(f.oldPath, r.globs)));
    if (risky) {
      out.push({ reason: `${f.path} is ${risky.label}, which takes effect without any flag`, evidence: first ? [ev(f, first)] : [] });
      continue;
    }
    if (matchesAny(f.path, config.flagFiles)) {
      for (const l of f.lines.filter((x) => x.kind === "add" && ON.test(x.text) && !OFF.test(x.text))) out.push({ reason: `${f.path} adds or changes a flag to on`, evidence: [ev(f, l)] });
      continue;
    }
    if (!code(f) || f.status === "deleted") continue;
    for (const l of f.lines.filter((x) => x.kind === "add")) {
      const hit = startup.find((re) => re.test(l.text));
      if (hit) out.push({ reason: `${f.path} adds code that runs at startup (${hit.source})`, evidence: [ev(f, l)] });
    }
    // New code under a negated gate runs while the flag is off. Existing code newly wrapped in one (a kill switch) does not change anything.
    const removed = new Set(f.lines.filter((l) => l.kind === "remove").map((l) => norm(l.text)));
    f.lines.forEach((l, i) => {
      if (l.kind !== "add" || !negated.test(l.text)) return;
      const body = gatedBody(f.lines, i, negated);
      // `if (!isEnabled(x)) return …`: an early exit while the flag is off keeps the new code after it off.
      if (body.length === 1 && /^return\b/.test(body[0]!)) return;
      const fresh = body.filter((t) => ![...removed].some((r) => r.includes(t.replace(/;$/, ""))));
      if (fresh.length) out.push({ reason: `${f.path} adds code under a negated flag check, which runs while the flag is off`, evidence: [ev(f, l)] });
    });
    const added = f.lines.filter(meaningful);
    if (!added.length || f.lines.some((l) => l.kind !== "remove" && gate.test(l.text))) continue;
    // A new file that only declares things runs nothing until something calls it; the screens judge that.
    if (f.status === "added" && added.every((l) => DECLARATION.test(l.text) || /^\s/.test(l.text))) continue;
    out.push({ reason: `${f.path} changes code with no flag check in the file`, evidence: added.slice(0, 2).map((l) => ev(f, l)) });
  }
  return out;
}

/** Changes that turn a flag on: an added "on" line in a flag file, or any change to a rollout file. */
function activations(ctx: RunContext<InertConfig>): Problem[] {
  const out: Problem[] = [];
  for (const f of ctx.diff) {
    if (matchesAny(f.path, ctx.config.rolloutFiles)) {
      const l = f.lines.find((x) => x.kind !== "context");
      out.push({ reason: `${f.path} is a rollout file`, evidence: l ? [ev(f, l)] : [] });
    } else if (matchesAny(f.path, ctx.config.flagFiles)) {
      for (const l of f.lines.filter((x) => x.kind === "add" && ON.test(x.text) && !OFF.test(x.text))) out.push({ reason: `${f.path} turns a flag on`, evidence: [ev(f, l)] });
    }
  }
  return out;
}

const screenedFiles = (ctx: RunContext<InertConfig>) => ctx.diff.filter((f) => code(f) && f.status !== "deleted" && !matchesAny(f.path, ctx.config.flagFiles) && f.lines.some(meaningful));

const RULE = (flags: string[]) => `This change is meant to be inert on deployment: its new behavior should only run when a feature flag is turned on${flags.length ? ` (${flags.map((f) => `\`${f}\``).join(", ")})` : ""}, and every flag defaults to off.

Compare what the code did before this change with what it does after, with every feature flag off. Does anything differ that runs, or that a user, another service or the database could observe?

Count as "yes": changed behavior outside the flag check; new code that runs when the flag is off (for example under \`if (!isEnabled(...))\`, even when the flag is meant to switch it off later); code that runs when the module is loaded or the server starts; routes or jobs registered unconditionally; data written or reshaped regardless of the flag; an always-true flag check; and a flag whose default is changed to on.

Count as "no": new code reachable only when a flag is on; code that ran before and still runs the same way with flags off (for example existing code newly wrapped in a "disable" flag); tests, comments, and type-only changes.`;

export type InertStatus = "verified" | "disproved" | "unclear";

/** The claim's result from code and the screens. */
export function judge(ctx: RunContext<InertConfig>): { status: InertStatus; reasons: string[]; evidence: Evidence[] } | null {
  const flags = claimedFlags(ctx.pull, ctx.config.label);
  if (flags === null) return null;
  const problems = disqualifiers(ctx);
  const answers = new Map(ctx.screens.map((a) => [a.key, a]));
  const unclear: string[] = [];
  screenedFiles(ctx).forEach((f, i) => {
    const a = answers.get(`file:${i}`);
    if (!a || a.status !== "answered") return unclear.push(`${f.path} was not checked${a?.why ? ` (${a.why})` : ""}`);
    const pYes = a.result === "yes" ? a.confidence : 1 - a.confidence;
    if (pYes > ctx.config.maxP) problems.push({ reason: `${f.path}: ${a.reason.slice(0, 300)}`, evidence: a.quotes.map((q) => ({ source: "diff", where: q.file, line: q.line, text: q.text })) });
  });
  if (problems.length) return { status: "disproved", reasons: problems.map((p) => p.reason), evidence: problems.flatMap((p) => p.evidence).slice(0, MAX_EVIDENCE) };
  if (unclear.length) return { status: "unclear", reasons: unclear, evidence: [] };
  return { status: "verified", reasons: [], evidence: [] };
}

export default defineExtension({
  id: "inert",
  version: "1.0.0",
  title: "Inert check",
  summary: "Tries to disprove an author's claim that a change is switched off behind a feature flag, and asks a person whenever a change turns a flag on.",
  needs: ["core"],
  config: {
    schema,
    fields: [
      { key: "label", label: "Label that claims a change is inert", help: "Or a line `PullUp-Inert: flag=<name>` in the description.", kind: "text", loosens: false },
      { key: "flagFiles", label: "Flag definition files", help: "Globs. A flag added or changed to on here is a flag activation.", kind: "list", loosens: false },
      { key: "rolloutFiles", label: "Rollout files", help: "Globs. Any change to them is a flag activation, which a person decides.", kind: "list", loosens: false },
      { key: "gatePatterns", label: "Flag checks in code", help: "Regular expressions, for example isEnabled\\(.", kind: "list", loosens: false },
      { key: "startupPatterns", label: "Code that runs at startup", help: "Regular expressions, for example app\\.(get|post)\\(.", kind: "list", loosens: false },
      { key: "maxP", label: "Most a screen may lean to \"something differs\"", help: "From 0 to 1; default 0.3 (strict).", kind: "number", loosens: true },
      { key: "askWhenDisproved", label: "Ask a person when a claim is disproved", help: "Off: a note only.", kind: "boolean", loosens: false },
      { key: "relaxSensitiveWhenInert", label: "A verified inert change lets the council pass a sensitive path alone", help: "Off by default. This loosens PullUp.", kind: "boolean", loosens: true },
    ],
  },
  relaxations: [{ kind: "council-may-pass", field: "relaxSensitiveWhenInert" }],
  screens(ctx) {
    const flags = claimedFlags(ctx.pull, ctx.config.label);
    if (flags === null) return [];
    return screenedFiles(ctx).map(
      (f, i): ScreenRequest => ({
        key: `file:${i}`,
        file: f.path,
        question: `With every feature flag off, does the change to ${f.path} alter anything that runs, or that a user, another service or the database could observe? "yes" means something differs.`,
        guidance: RULE(flags),
        options: ["yes", "no"],
      }),
    );
  },
  detect(ctx) {
    const questions: QuestionDraft[] = [];
    const on = activations(ctx);
    if (on.length) {
      questions.push({
        key: "flag-activation",
        prompt: "This change turns a feature flag on. Is it ready to be exposed?",
        summary: `Flag activation: ${on.map((a) => a.reason).join("; ")}.`,
        evidence: on.flatMap((a) => a.evidence).slice(0, MAX_EVIDENCE),
        councilMayPass: false,
        neverRelax: true,
      });
    }
    const result = judge(ctx);
    if (!result) return { questions };
    const flags = claimedFlags(ctx.pull, ctx.config.label)!;
    if (result.status === "disproved" && ctx.config.askWhenDisproved) {
      questions.push({
        key: "disproved",
        prompt: "The author says this change is switched off behind a flag, but PullUp found otherwise. Should it pass?",
        summary: `Inert claim disproved: ${result.reasons.join("; ")}`.slice(0, 2000),
        evidence: result.evidence,
        councilMayPass: false,
      });
    }
    return {
      questions,
      facts: [{ kind: "inert", flags, status: result.status, reasons: result.reasons }],
      relax: result.status === "verified" ? [{ question: "core:sensitive-path", kind: "council-may-pass", why: `verified switched off behind ${flags.map((f) => `\`${f}\``).join(", ") || "a flag"}` }] : [],
    };
  },
  notes(ctx) {
    const result = judge(ctx);
    if (!result) return [];
    const flags = claimedFlags(ctx.pull, ctx.config.label)!;
    const what = `Inert claim${flags.length ? ` (${flags.join(", ")})` : ""}`;
    if (result.status === "verified") return [{ text: `${what}: verified. No code problem found, and every changed file was judged the same with flags off.` }];
    return [{ text: `${what}: ${result.status}. ${result.reasons.slice(0, 4).join("; ")}`.slice(0, 1000) }];
  },
});
