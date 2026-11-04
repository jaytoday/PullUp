/**
 * Failing test names from JUnit XML (the format most test runners can write).
 * A test case fails when it holds a <failure> or <error>. Names are
 * "classname > name" (or just the name), matching how the known-flaky list is written.
 */
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function junitFailures(xml: string): string[] {
  const out: string[] = [];
  const cases = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of xml.matchAll(cases)) {
    const body = m[3] ?? "";
    if (!/<(failure|error)\b/.test(body)) continue;
    const name = attr(m[1]!, "name");
    if (!name) continue;
    const cls = attr(m[1]!, "classname");
    out.push(unescape(cls ? `${cls} > ${name}` : name));
  }
  return [...new Set(out)];
}
