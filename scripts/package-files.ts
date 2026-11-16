import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Every text file in a decision package folder, keyed by its path inside the folder (what `askwithai push` sends). */
export function readPackage(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ya?ml|md|json|jsonl)$/.test(name)) files[relative(dir, p).split("\\").join("/")] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return files;
}
