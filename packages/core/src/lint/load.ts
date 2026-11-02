// A repo's lint rules as one set: the rule files read from one place (the
// default branch on GitHub, a git ref, or a local folder), parsed, with every
// problem kept so the owner can see why a rule does not run.

import { sha256 } from "../signals/hunks.js";
import type { LintRule, LintRuleProblem } from "./rules.js";
import { parseLintRule } from "./rules.js";

/** One rule file: its path inside the rules folder and its text. */
export interface LintRuleFile {
  readonly path: string;
  readonly content: string;
}

export type LintRuleSourceKind = "default-branch" | "git-ref" | "directory" | "fixture";

/** What the store keeps: the raw files, re-parsed on every read so parser fixes apply. */
export interface LintRuleSnapshot {
  readonly repoId: string;
  readonly source: LintRuleSourceKind;
  /** Branch or ref the files were read at (null for a local folder). */
  readonly ref: string | null;
  /** Commit the files were read at, when known. */
  readonly commitSha: string | null;
  /** The rules folder inside the repo, such as `.agents/gallant`. */
  readonly dir: string;
  readonly files: readonly LintRuleFile[];
  readonly fetchedAt: string;
}

export interface LintRuleSet {
  readonly source: LintRuleSourceKind;
  readonly ref: string | null;
  readonly commitSha: string | null;
  readonly dir: string;
  /** Rules that can run, in path order. */
  readonly rules: readonly LintRule[];
  /** Files that were not used, and why. */
  readonly problems: readonly LintRuleProblem[];
  /** sha256 over every usable rule's path and content (changes when any rule changes). */
  readonly hash: string;
}

/** More rules than this are ignored (in path order), to bound cost per file. */
export const MAX_LINT_RULES = 50;

/** Gallant's file filter: Markdown files, skipping hidden files and anything inside a hidden folder. */
export function isLintRulePath(path: string): boolean {
  if (path.split("/").some((part) => part.startsWith(".") || part === "")) return false;
  return /\.(md|markdown)$/i.test(path);
}

export function buildLintRuleSet(
  snapshot: Pick<LintRuleSnapshot, "source" | "ref" | "commitSha" | "dir" | "files">,
): LintRuleSet {
  const rules: LintRule[] = [];
  const problems: LintRuleProblem[] = [];
  const files = [...snapshot.files].filter((f) => isLintRulePath(f.path)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of files) {
    const parsed = parseLintRule(f.path, f.content);
    if (!parsed.ok) {
      problems.push(parsed.problem);
      continue;
    }
    const r = parsed.rule;
    if (r.appliesTo.length === 0) {
      problems.push({ path: r.path, message: "has no appliesTo glob, so it never runs (as in Gallant)" });
      continue;
    }
    if (r.type !== "noul" && !r.violation) {
      problems.push({ path: r.path, message: `is a ${r.type} rule with no violation condition, so it can never fail; not run` });
      continue;
    }
    if (rules.length >= MAX_LINT_RULES) {
      problems.push({ path: r.path, message: `over the limit of ${MAX_LINT_RULES} rules; not run` });
      continue;
    }
    rules.push(r);
  }
  return {
    source: snapshot.source,
    ref: snapshot.ref,
    commitSha: snapshot.commitSha,
    dir: snapshot.dir,
    rules,
    problems,
    hash: sha256(...rules.flatMap((r) => [r.path, r.hash])),
  };
}
