// A deterministic stand-in for the live evidence verifier (offline default and
// tests). Seeded by the finding id and the hunk contents: three in four
// findings are "confirmed" with the first substantive changed line as evidence,
// the rest "not-confirmed". It never calls a model and costs nothing.

import { sha256 } from "../signals/hunks.js";
import { changedLines } from "../verify/accept.js";
import type { EvidenceVerifier, RawVerdict, VerifyRequest } from "../verify/types.js";

export class SyntheticEvidenceVerifier implements EvidenceVerifier {
  readonly id = "synthetic-verifier-v1";

  async verify(req: VerifyRequest): Promise<RawVerdict> {
    const lines = req.hunks.flatMap((h) => changedLines(h).map((l) => ({ ...l, path: h.path })));
    const first = lines.find((l) => l.text.trim().length >= 8);
    const seed = Number.parseInt(sha256(req.finding.id, ...req.hunks.map((h) => h.contentHash)).slice(0, 8), 16);
    if (!first || seed % 4 === 0) {
      return { verdict: "not-confirmed", evidence: [], fix: null, reason: "Synthetic verifier: no changed line clearly supports the claim.", costUsd: 0 };
    }
    return {
      verdict: "confirmed",
      evidence: [{ path: first.path, line: first.line, quote: first.text.trim().slice(0, 120) }],
      fix: "Restore the check this change removes, or explain in the pull request why it is safe.",
      reason: "Synthetic verifier: the quoted changed line matches what the question asks about.",
      costUsd: 0,
    };
  }
}
