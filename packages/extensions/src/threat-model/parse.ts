/**
 * Reads a threat model written in the layout of the Warden DNS resolver's
 * public SECURITY.md: threats in scope, each with one control and the code
 * that implements it; threats out of scope; settings the operator must turn
 * on; and the ways into the system. Plain code, no model:
 *
 *   ## In scope
 *   | ID | Threat | Control | Code |
 *   | --- | --- | --- | --- |
 *   | T3 | Forged webhook | Signature check | `src/webhook.ts` → `verifySignature` |
 *   ## Out of scope
 *   - ARP spoofing: handled by the network layer.
 *   ## Operator contract
 *   - `branch-protection-requires: PullUp` — Branch protection requires the PullUp check.
 *   ## Entry points
 *   - `src/app/api/**\/route.ts`, `fetch(`
 *
 * The sections may also sit inside a larger file (for example SECURITY.md):
 * only these four headings are read, at any heading level.
 */

export interface CodeRef {
  path: string;
  /** A function, method or class in that file, when the row names one. */
  symbol: string | null;
}

export interface Threat {
  id: string;
  threat: string;
  control: string;
  code: CodeRef[];
  /** 1-based line in the file, for messages. */
  line: number;
}

export interface ThreatModel {
  inScope: Threat[];
  outOfScope: { name: string; reason: string }[];
  contract: { key: string; text: string }[];
  /** File globs (a new file matching one is a new entry point) and code patterns (an added line containing one). */
  entryPoints: { globs: string[]; code: string[] };
  /** Problems that make the file unreliable. A model with problems is never treated as "nothing to check". */
  problems: string[];
}

type Section = "in" | "out" | "contract" | "entry" | null;
const HEADINGS: [RegExp, Section][] = [
  [/^in scope\b/i, "in"],
  [/^out of scope\b/i, "out"],
  [/^operator contract\b/i, "contract"],
  [/^entry points?\b/i, "entry"],
];

const ticks = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim()).filter(Boolean);
const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function codeRefs(cell: string): CodeRef[] {
  // `path` → `symbol`, several separated by ";", "," or <br>.
  return cell
    .split(/;|<br\s*\/?>|,(?=\s*`)/i)
    .map((part) => {
      const [path, symbol] = ticks(part);
      return path ? { path: path.replace(/^\.?\//, ""), symbol: symbol ?? null } : null;
    })
    .filter((r): r is CodeRef => r !== null);
}

export function parseThreatModel(text: string): ThreatModel {
  const model: ThreatModel = { inScope: [], outOfScope: [], contract: [], entryPoints: { globs: [], code: [] }, problems: [] };
  let section: Section = null;
  let sawSections = 0;
  let header: string[] | null = null;
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const found = HEADINGS.find(([re]) => re.test(heading[1]!.trim()));
      section = found ? found[1] : null;
      if (found) sawSections++;
      header = null;
      return;
    }
    if (!line || section === null) return;
    if (section === "in" && line.startsWith("|")) {
      const c = cells(line);
      if (c.every((x) => /^:?-{2,}:?$/.test(x))) return;
      if (!header) {
        header = c.map((x) => x.toLowerCase());
        if (!["id", "threat", "control", "code"].every((h) => header!.includes(h))) model.problems.push(`line ${n}: the In scope table needs the columns ID, Threat, Control and Code.`);
        return;
      }
      const col = (name: string) => c[header!.indexOf(name)] ?? "";
      if (c.length < header.length) {
        model.problems.push(`line ${n}: row has ${c.length} columns, the table has ${header.length}.`);
        return;
      }
      const id = col("id").replace(/`/g, "");
      if (!/^[A-Za-z0-9._-]{1,40}$/.test(id)) {
        model.problems.push(`line ${n}: "${id}" is not a usable threat ID (letters, digits, dot, dash).`);
        return;
      }
      if (model.inScope.some((t) => t.id === id)) {
        model.problems.push(`line ${n}: threat ID ${id} is used twice.`);
        return;
      }
      const code = codeRefs(col("code"));
      if (!code.length) model.problems.push(`line ${n}: ${id} has no code in backticks in its Code column.`);
      model.inScope.push({ id, threat: col("threat"), control: col("control"), code, line: n });
      return;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line)?.[1];
    if (!bullet) return;
    if (section === "out") {
      const [name, ...reason] = bullet.split(":");
      model.outOfScope.push({ name: name!.trim(), reason: reason.join(":").trim() });
    } else if (section === "contract") {
      const key = ticks(bullet)[0];
      if (key) model.contract.push({ key, text: bullet.replace(/^`[^`]+`\s*[—–-]?\s*/, "") });
      else model.problems.push(`line ${n}: an operator contract item needs its setting in backticks.`);
    } else if (section === "entry") {
      for (const p of ticks(bullet)) (p.includes("(") || !/[/*.]/.test(p) ? model.entryPoints.code : model.entryPoints.globs).push(p);
    }
  });
  if (!sawSections) model.problems.push("no In scope, Out of scope, Operator contract or Entry points heading was found.");
  else if (!model.inScope.length) model.problems.push("the In scope section lists no threats.");
  return model;
}
