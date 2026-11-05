import { defineExtension, matchesAny } from "@pullup/sdk";
import { z } from "zod";

/**
 * Who to ask: the code owners of the files a question's evidence points at,
 * from the repository's CODEOWNERS file on the default branch. GitHub logins
 * and teams are mapped to WithAI people (member id, email or phone) through
 * `people`; email owners are used as they are. A question with no mapped
 * owner falls through to the next extension, then to `ask.to`. It never adds
 * or changes a question.
 */

export const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

const schema = z.object({
  /** GitHub login or team (`@octocat`, `@acme/payments`) → WithAI person (member id, email or phone). */
  people: z.record(z.string(), z.string().min(1)).default({}),
  /** At most this many people are asked about one question. */
  maxPeople: z.number().int().min(1).max(5).default(2),
});

export interface OwnerRule {
  globs: string[];
  owners: string[];
}

/** CODEOWNERS patterns (gitignore-like) as PullUp globs. The last matching rule wins, as on GitHub. */
export function parseCodeowners(text: string): OwnerRule[] {
  const rules: OwnerRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    let p = pattern!;
    if (p === "*") p = "**";
    const anchored = p.startsWith("/");
    p = p.replace(/^\//, "");
    // A pattern with no slash (other than a trailing one) matches at any depth.
    if (!anchored && !p.replace(/\/$/, "").includes("/") && p !== "**") p = `**/${p}`;
    const globs = p.endsWith("/") ? [`${p}**`] : [p, `${p}/**`];
    rules.push({ globs, owners });
  }
  return rules;
}

export function ownersOf(rules: OwnerRule[], path: string): string[] {
  for (let i = rules.length - 1; i >= 0; i--) if (matchesAny(path, rules[i]!.globs)) return rules[i]!.owners;
  return [];
}

const norm = (login: string) => login.replace(/^@/, "").toLowerCase();

/** The first of the CODEOWNERS locations GitHub reads, in its order. */
const codeownersFile = (files: { path: string; text: string }[]) => CODEOWNERS_PATHS.map((p) => files.find((f) => f.path === p)).find(Boolean) ?? null;

export default defineExtension({
  id: "codeowners",
  version: "1.0.0",
  title: "Code owners",
  summary: "Asks the code owners of the files a question is about, instead of one person for the whole repository.",
  config: {
    schema,
    fields: [
      { key: "people", label: "GitHub login → WithAI person", help: "For example @octocat → octocat@example.com. Owners with no entry are skipped.", kind: "list", loosens: false },
      { key: "maxPeople", label: "At most this many people per question", help: "Any of them may answer; the first answer counts.", kind: "number", loosens: false },
    ],
  },
  reads: () => [{ from: "default", globs: CODEOWNERS_PATHS }],
  notes({ files, config }) {
    const file = codeownersFile(files);
    if (!file) return [{ text: "No CODEOWNERS file on the default branch: questions go to ask.to." }];
    const mapped = new Set(Object.keys(config.people).map(norm));
    const unmapped = [...new Set(parseCodeowners(file.text).flatMap((r) => r.owners))].filter((o) => !o.includes("@", 1) && !mapped.has(norm(o)));
    return unmapped.length ? [{ text: `Code owners with no WithAI person in codeowners.people (questions for their files go to ask.to): ${unmapped.slice(0, 8).join(", ")}.` }] : [];
  },
  recipients({ files, config }, question) {
    const file = codeownersFile(files);
    if (!file) return null;
    const rules = parseCodeowners(file.text);
    const people = new Map(Object.entries(config.people).map(([login, person]) => [norm(login), person]));
    const out: string[] = [];
    for (const e of question.evidence) {
      if (e.source !== "diff") continue;
      for (const owner of ownersOf(rules, e.where)) {
        // An email owner (no leading @) is a WithAI person as it is.
        const person = owner.startsWith("@") ? people.get(norm(owner)) : owner.includes("@") ? owner : people.get(norm(owner));
        if (person && !out.includes(person)) out.push(person);
      }
    }
    return out.length ? out.slice(0, config.maxPeople) : null;
  },
});
