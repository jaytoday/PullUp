// The evidence verifier port. Core never calls a model: live verifiers plug in
// here (@pullup/verify), and a deterministic synthetic verifier serves fixtures
// and tests (@pullup/core/testing).

import type { Finding } from "../findings/findings.js";
import type { HunkRecord } from "../schema/domain.js";

export interface VerifyRequest {
  readonly repoId: string;
  readonly pullNumber: number;
  readonly headSha: string;
  readonly finding: Pick<Finding, "id" | "level" | "title" | "detail">;
  /** The yes/no question that fired (its plain-language text). */
  readonly question: string;
  /** The hunks behind the finding (code only — no pull request title, body or comments). */
  readonly hunks: readonly HunkRecord[];
}

export interface EvidenceItem {
  readonly path: string;
  /** Line number on the side the quote comes from (new side for added lines, old side for removed). */
  readonly line: number;
  readonly quote: string;
}

export type VerdictKind = "confirmed" | "not-confirmed" | "unsure";

/** What a verifier returns (untrusted until `acceptVerdict` checks it). */
export interface RawVerdict {
  readonly verdict: VerdictKind;
  readonly evidence: readonly EvidenceItem[];
  readonly fix: string | null;
  readonly reason: string;
  readonly costUsd: number;
  /** Set when the call failed (auth, rate limit, refusal…): the verdict is then `unsure`. */
  readonly error?: string;
}

export interface EvidenceVerifier {
  /** Model id plus prompt/schema version — part of the cache key. */
  readonly id: string;
  verify(req: VerifyRequest): Promise<RawVerdict>;
}

/** A verdict after the deterministic checks. Only `accepted && verdict === "confirmed"` can enable request changes. */
export interface FindingVerdict {
  readonly verdict: VerdictKind;
  /** True when a confirmed verdict passed every check (quotes in changed lines, clean text). */
  readonly accepted: boolean;
  readonly evidence: readonly EvidenceItem[];
  readonly fix: string | null;
  readonly reason: string;
  readonly verifierId: string;
  /** Why a confirmed verdict was downgraded, when it was. */
  readonly rejected?: readonly string[];
}

/** One cached verdict (content-addressed by finding, hunks and verifier). */
export interface VerdictRecord {
  readonly cacheKey: string;
  readonly repoId: string;
  readonly pullNumber: number;
  readonly findingId: string;
  /** Hash of the finding's hunk contents — a push that changes them needs a new verdict. */
  readonly hunksHash: string;
  readonly verdict: FindingVerdict;
  readonly costUsd: number;
  readonly createdAt: string;
}

export interface VerifyRunRecord {
  readonly repoId: string;
  readonly runAt: string;
  readonly verifierId: string;
  readonly verified: number;
  readonly cached: number;
  readonly skipped: readonly { readonly pullNumber: number; readonly findingId: string; readonly reason: string }[];
  readonly costUsd: number;
  readonly errors: readonly string[];
}
