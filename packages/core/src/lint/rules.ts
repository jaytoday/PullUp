// Parses lint rule files written for the Gallant linter, so one folder of
// rules (`.agents/gallant/` by default) works for a developer running Gallant
// before a push and for PullUp on the pull request.
//
// A rule is a Markdown file: YAML frontmatter between two `---` lines, then
// the rule text, which is sent to the model as written. Frontmatter fields
// follow Gallant (`appliesTo`, `type`, `criteria`, `violation`,
// `minConfidence`). PullUp adds one optional field, `pullupLevel` (p1 | p2),
// which Gallant ignores. A rule that Gallant would reject is rejected here
// too, with the reason, so a broken rule is visible instead of silently
// never firing.

import { parse as parseYaml } from "yaml";
import type { LintLevel } from "../config/lint.js";
import { LINT_LEVELS } from "../config/lint.js";
import { characterProblems } from "../config/screen.js";
import { sha256 } from "../signals/hunks.js";

export type LintRuleType = "noul" | "choice" | "score";

/** When a choice or score rule fails: some `if` result above its threshold, and no `unless` result above its own. */
export interface LintViolation {
  readonly if: Readonly<Record<string, number>>;
  readonly unless: Readonly<Record<string, number>>;
}

export interface LintRule {
  /** Path inside the rules folder, such as `go/leftover-debugging.md`. */
  readonly path: string;
  /** Finding id: `lint:<path>`. */
  readonly id: string;
  /** Question id sent to the model: letters, digits and underscore only, stable for the rule's content. */
  readonly wireId: string;
  /** sha256 of the file's content. */
  readonly hash: string;
  readonly appliesTo: readonly string[];
  readonly type: LintRuleType;
  /** choice: option → description, in file order. */
  readonly options?: Readonly<Record<string, string>>;
  /** score: levels, lowest first. */
  readonly levels?: readonly string[];
  /** noul: the probability of "yes" above which the rule fails. */
  readonly minConfidence: number;
  /** choice / score: when the rule fails. */
  readonly violation: LintViolation | null;
  /** PullUp-only `pullupLevel`, or null to use the config's level. */
  readonly level: LintLevel | null;
  /** The rule text after the frontmatter, verbatim. */
  readonly body: string;
}

export interface LintRuleProblem {
  readonly path: string;
  readonly message: string;
}

export type ParsedLintRule = { readonly ok: true; readonly rule: LintRule } | { readonly ok: false; readonly problem: LintRuleProblem };

export const DEFAULT_MIN_CONFIDENCE = 0.5;
/** Larger rules would eat the model's input budget for the code itself. */
export const MAX_RULE_BODY_CHARS = 8_000;
export const MAX_RULE_FILE_BYTES = 16_384;

/** Option and level names appear in PullUp's comments, so they stay short and plain. */
const RESULT_NAME = /^[\p{L}\p{N} _.,'()/+-]{1,60}$/u;

/**
 * Splits `---` frontmatter from the body. The first line must be exactly
 * `---`; the block ends at the next line that is exactly `---` (a trailing
 * carriage return is ignored). The body is everything after, verbatim.
 */
export function splitFrontmatter(src: string): { fm: string; body: string } | { error: string } {
  const lines = src.split("\n");
  if ((lines[0] ?? "").replace(/\r$/, "") !== "---") return { error: "missing frontmatter: a rule must begin with a --- block" };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.replace(/\r$/, "") === "---") {
      return { fm: lines.slice(1, i).join("\n"), body: lines.slice(i + 1).join("\n") };
    }
  }
  return { error: "unclosed frontmatter: no closing ---" };
}

/**
 * Go's `path.Match` on one file name: `*` (any run of non-`/`), `?` (one
 * non-`/`), `[...]` classes with ranges and `^` negation, and `\` escapes.
 * Returns null for a malformed pattern.
 */
export function globToNameRegExp(glob: string): RegExp | null {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "\\") {
      if (i + 1 >= glob.length) return null;
      re += escapeRe(glob[++i]!);
    } else if (c === "[") {
      let j = i + 1;
      let cls = "";
      if (glob[j] === "^") {
        cls += "^";
        j++;
      }
      let items = 0;
      for (; j < glob.length && glob[j] !== "]"; j++) {
        let lo = glob[j]!;
        // As in Go, an unescaped "-" can't start a range.
        if (lo === "-") return null;
        if (lo === "\\") {
          if (j + 1 >= glob.length) return null;
          lo = glob[++j]!;
        }
        cls += escapeClass(lo);
        if (glob[j + 1] === "-" && glob[j + 2] !== undefined && glob[j + 2] !== "]") {
          let hi = glob[j + 2]!;
          j += 2;
          if (hi === "\\") {
            if (j + 1 >= glob.length) return null;
            hi = glob[++j]!;
          }
          if (hi < lo) return null;
          cls += `-${escapeClass(hi)}`;
        }
        items++;
      }
      if (j >= glob.length || items === 0) return null;
      re += cls.startsWith("^") ? `[^/${cls.slice(1)}]` : `[${cls}]`;
      i = j;
    } else re += escapeRe(c);
  }
  try {
    return new RegExp(`${re}$`, "u");
  } catch {
    return null;
  }
}

function escapeRe(c: string): string {
  return /[.*+?^${}()|[\]\\/]/.test(c) ? `\\${c}` : c;
}

function escapeClass(c: string): string {
  return /[\]\\^-]/.test(c) ? `\\${c}` : c;
}

/** Whether a rule applies to a file: a glob matches the file's name (not its folder), as in Gallant. */
export function ruleApplies(rule: Pick<LintRule, "appliesTo">, filePath: string): boolean {
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  return rule.appliesTo.some((g) => globToNameRegExp(g)?.test(name) ?? false);
}

/** Wire-safe question id for a rule: positional ids are what Gallant uses, but a content hash keeps the cache stable. */
export function lintWireId(path: string, hash: string): string {
  return `r_${sha256(path, hash).slice(0, 12)}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function thresholds(raw: unknown, where: string, known: ReadonlySet<string>): Record<string, number> | string {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) return `violation.${where} must map results to probabilities`;
  const out: Record<string, number> = {};
  for (const [name, p] of Object.entries(raw)) {
    if (!known.has(name)) return `violation.${where} names unknown result "${name}"`;
    if (typeof p !== "number" || !(p >= 0 && p <= 1)) return `violation.${where} threshold for "${name}" must be between 0 and 1`;
    out[name] = p;
  }
  return out;
}

/** Parses one rule file. `path` is its path inside the rules folder. */
export function parseLintRule(path: string, content: string): ParsedLintRule {
  const fail = (message: string): ParsedLintRule => ({ ok: false, problem: { path, message } });
  if (new TextEncoder().encode(content).length > MAX_RULE_FILE_BYTES) return fail(`is larger than ${MAX_RULE_FILE_BYTES} bytes`);
  const chars = characterProblems(content);
  if (chars.length > 0) return fail(chars.join("; "));
  const split = splitFrontmatter(content);
  if ("error" in split) return fail(split.error);

  let fm: unknown;
  try {
    fm = split.fm.trim() === "" ? {} : parseYaml(split.fm);
  } catch (err) {
    return fail(`frontmatter is not valid YAML: ${(err as Error).message.split("\n")[0]}`);
  }
  if (!isRecord(fm)) return fail("frontmatter must be a mapping of fields");

  const type = fm.type;
  if (type !== "noul" && type !== "choice" && type !== "score") return fail(`missing or invalid type ${JSON.stringify(type ?? "")}`);

  // appliesTo: one glob or a list of them.
  const rawGlobs = fm.appliesTo;
  const appliesTo =
    rawGlobs === undefined || rawGlobs === null || rawGlobs === ""
      ? []
      : typeof rawGlobs === "string"
        ? [rawGlobs]
        : Array.isArray(rawGlobs) && rawGlobs.every((g) => typeof g === "string")
          ? (rawGlobs as string[])
          : null;
  if (appliesTo === null) return fail("appliesTo: expected a string or a list of strings");
  for (const g of appliesTo) if (!globToNameRegExp(g)) return fail(`invalid appliesTo glob "${g}"`);

  let options: Record<string, string> | undefined;
  let levels: string[] | undefined;
  if (type === "choice") {
    if (!isRecord(fm.criteria) || Object.keys(fm.criteria).length === 0) return fail("type choice requires criteria options");
    options = {};
    for (const [k, v] of Object.entries(fm.criteria)) {
      if (!RESULT_NAME.test(k)) return fail(`option name "${k.slice(0, 40)}" must be 1-60 plain characters`);
      options[k] = v === null || v === undefined ? "" : String(v);
    }
    if (Object.keys(options).length < 2) return fail("type choice needs at least two options");
  } else if (type === "score") {
    if (!Array.isArray(fm.criteria) || fm.criteria.length === 0) return fail("type score requires criteria levels");
    levels = fm.criteria.map((l) => String(l));
    if (levels.length < 2 || levels.length > 10) return fail("type score needs 2 to 10 levels");
    for (const l of levels) if (!RESULT_NAME.test(l)) return fail(`level name "${l.slice(0, 40)}" must be 1-60 plain characters`);
  }

  let minConfidence = type === "noul" ? DEFAULT_MIN_CONFIDENCE : 0;
  if (fm.minConfidence !== undefined) {
    if (type !== "noul") return fail("minConfidence is only supported for type noul");
    if (typeof fm.minConfidence !== "number" || !(fm.minConfidence >= 0 && fm.minConfidence <= 1)) {
      return fail("minConfidence must be between 0 and 1");
    }
    minConfidence = fm.minConfidence;
  }

  let violation: LintViolation | null = null;
  if (fm.violation !== undefined && fm.violation !== null) {
    if (type === "noul") return fail("violation is only supported for type choice or score; use minConfidence for a noul");
    if (!isRecord(fm.violation)) return fail("violation must be a mapping with if (and optionally unless)");
    const extra = Object.keys(fm.violation).filter((k) => k !== "if" && k !== "unless");
    if (extra.length > 0) return fail(`violation: unknown field "${extra[0]}"`);
    const names = type === "choice" ? Object.keys(options!) : levels!;
    if (new Set(names).size !== names.length) return fail("violation requires unique criteria levels");
    const known = new Set(names);
    const ifs = thresholds(fm.violation.if, "if", known);
    if (typeof ifs === "string") return fail(ifs);
    if (Object.keys(ifs).length === 0) return fail("violation requires at least one result under if");
    const unless = thresholds(fm.violation.unless, "unless", known);
    if (typeof unless === "string") return fail(unless);
    violation = { if: ifs, unless };
  }

  let level: LintLevel | null = null;
  if (fm.pullupLevel !== undefined && fm.pullupLevel !== null) {
    if (!(LINT_LEVELS as readonly unknown[]).includes(fm.pullupLevel)) return fail("pullupLevel must be p1 or p2 (lint rules are capped at P1)");
    level = fm.pullupLevel as LintLevel;
  }

  if (split.body.trim() === "") return fail("has no rule text after the frontmatter");
  if (split.body.length > MAX_RULE_BODY_CHARS) return fail(`rule text is ${split.body.length} characters (max ${MAX_RULE_BODY_CHARS})`);

  const hash = sha256(content);
  return {
    ok: true,
    rule: {
      path,
      id: `lint:${path}`,
      wireId: lintWireId(path, hash),
      hash,
      appliesTo,
      type,
      ...(options ? { options } : {}),
      ...(levels ? { levels } : {}),
      minConfidence,
      violation,
      level,
      body: split.body,
    },
  };
}

/** The result names a rule is answered from, and their probabilities in an answer. */
export interface LintVerdict {
  readonly fails: boolean;
  /** Plain reason, such as `useless 0.95 > 0.5` or `yes 0.93 > 0.5`. */
  readonly reason: string;
  /** The probability of the result that decided it (for ranking). */
  readonly p: number;
}

const fmt = (p: number) => String(Math.round(p * 10_000) / 10_000);

function firstAbove(clauses: Readonly<Record<string, number>>, prob: Readonly<Record<string, number>>) {
  for (const name of Object.keys(clauses).sort()) {
    const p = prob[name] ?? 0;
    if (p > clauses[name]!) return { name, p, threshold: clauses[name]! };
  }
  return null;
}

/** Gallant's rule: some `if` entry strictly above its threshold, and no `unless` entry above its own. Ties go to name order. */
export function judgeViolation(v: LintViolation, prob: Readonly<Record<string, number>>): LintVerdict {
  const trigger = firstAbove(v.if, prob);
  if (!trigger) return { fails: false, reason: "no if result above its threshold", p: 0 };
  const cancel = firstAbove(v.unless, prob);
  if (cancel) return { fails: false, reason: `unless ${cancel.name} ${fmt(cancel.p)} > ${fmt(cancel.threshold)}`, p: 0 };
  return { fails: true, reason: `${trigger.name} ${fmt(trigger.p)} > ${fmt(trigger.threshold)}`, p: trigger.p };
}
