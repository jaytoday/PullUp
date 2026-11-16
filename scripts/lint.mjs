#!/usr/bin/env node
// Project rules that a type checker cannot see. Fails with a list of every violation.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".next", ".next-e2e", ".git", "test-results", "playwright-report", ".data", "drizzle", "data", "vendor"]);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith(".claude") || name.startsWith(".next")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|md|yml|yaml|json|css)$/.test(name) && name !== "pnpm-lock.yaml") files.push(p);
  }
})(ROOT);

const code = (f) => /\.(ts|tsx)$/.test(f);
const rules = [
  { name: "no local filesystem paths", test: /\/Users\/[a-z]+\/|\/private\/tmp\//, appliesTo: (f) => !f.endsWith("lint.mjs") },
  { name: "use db.select(), never db.query.*", test: /\bdb\.query\.|\.findFirst\(|\.findMany\(/, appliesTo: code },
  { name: "no Radix, shadcn, Tailwind, Magic UI or React Bits (use Astryx)", test: /from ["'](radix-ui|@radix-ui\/[^"']+|cmdk|sonner|tailwind-merge|class-variance-authority|motion|lucide-react)["']|@import ["']tailwindcss/, appliesTo: (f) => code(f) || f.endsWith(".css") },
  { name: "no eval or new Function", test: /\beval\(|new Function\(/, appliesTo: code },
  { name: "the engine's browser entry only (no Node modules in screens)", test: /from ["']@pullup\/engine["']/, appliesTo: (f) => f.startsWith("src/components/") },
];

const problems = [];
for (const f of files) {
  const rel = relative(ROOT, f);
  const text = readFileSync(f, "utf8");
  for (const r of rules) {
    if (!r.appliesTo(rel)) continue;
    text.split("\n").forEach((line, i) => {
      if (r.test.test(line)) problems.push(`${rel}:${i + 1}  ${r.name}: ${line.trim().slice(0, 120)}`);
    });
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} lint problem(s).`);
  process.exit(1);
}
console.log(`lint: ${files.length} files, no problems.`);
