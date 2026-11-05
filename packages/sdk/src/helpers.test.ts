import { describe, expect, it } from "vitest";
import { parseDiff } from "./diff";
import { definesSymbol, inSymbol } from "./helpers";

describe("finding a function from a diff", () => {
  it("recognizes common definitions and not calls", () => {
    for (const line of ["export function verifySignature(body) {", "async function verifySignature() {", "const verifySignature = (a) =>", "def verifySignature(self):", "func verifySignature(b []byte) bool {", "func (s *S) verifySignature() {", "  verifySignature(body: string): boolean {", "export const verifySignature: Verifier = "]) {
      expect(definesSymbol(line, "verifySignature"), line).toBe(true);
    }
    for (const line of ["  if (!verifySignature(body)) return;", "import { verifySignature } from './webhook';", "function verifySignatureV2() {"]) {
      expect(definesSymbol(line, "verifySignature"), line).toBe(false);
    }
  });

  it("a changed line is inside a function when the hunk heading or the line itself defines it", () => {
    const [file] = parseDiff("--- a/w.ts\n+++ b/w.ts\n@@ -3,1 +3,1 @@ export function verifySignature(body: string) {\n-  return a == b;\n+  return safeEqual(a, b);\n@@ -20 +20 @@ function other() {\n-  x();\n+  y();\n");
    expect(file!.lines.map((l) => inSymbol(l, "verifySignature"))).toEqual([true, true, false, false]);
  });
});
