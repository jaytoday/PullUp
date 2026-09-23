// Unified-diff hunk splitting + content hashing. Pure: GitHub's `listFiles`
// returns a per-file `patch` string (no file headers), which we split on
// `@@ ... @@` lines. Files without a patch (binary / too large) become a single
// `noPatch` marker hunk so they are never silently treated as low-risk.

import { createHash } from "node:crypto";
import type { SourceHunk } from "../ingest/source.js";

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@.*$/;

/** sha256 hex of the joined parts (NUL-separated). */
export function sha256(...parts: readonly string[]): string {
  const h = createHash("sha256");
  parts.forEach((p, i) => {
    if (i > 0) h.update("\u0000");
    h.update(p);
  });
  return h.digest("hex");
}

/** Splits one file's patch into hunks. `patch` undefined/empty → noPatch marker. */
export function parseFilePatch(path: string, patch: string | null | undefined): SourceHunk[] {
  if (!patch) return [{ path, index: 0, header: "", patch: "", noPatch: true }];
  const hunks: SourceHunk[] = [];
  let header: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (header !== null) {
      hunks.push({ path, index: hunks.length, header, patch: body.join("\n") });
    }
  };
  for (const line of patch.split("\n")) {
    if (HUNK_HEADER.test(line)) {
      flush();
      header = line;
      body = [];
    } else if (header !== null) {
      body.push(line);
    } else {
      // Content before any header (unusual) — keep it as a header-less hunk.
      header = "";
      body = [line];
    }
  }
  flush();
  return hunks.length > 0 ? hunks : [{ path, index: 0, header: "", patch: "", noPatch: true }];
}

export function hunkContentHash(h: Pick<SourceHunk, "path" | "header" | "patch" | "noPatch">): string {
  return sha256(h.path, h.header, h.patch, h.noPatch ? "1" : "0");
}
