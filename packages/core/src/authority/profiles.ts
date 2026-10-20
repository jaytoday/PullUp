// Capability profiles (Agent Baseline CON-04): the most a repository lets
// PullUp send, whatever its action mode says. The repo's action mode is the
// *policy* (what PullUp wants to send); the profile is the *ceiling*; the
// effective level is the lower of the two.
//
// Profiles are defined in code and versioned. A repo is enrolled in exactly
// one, by an operator on the host (`pullup enroll`); the agent and the
// dashboard can read it but never choose or widen it. A repo that was never
// enrolled is treated as `observe`. Browser-safe (types and constants only).

import type { ActionAuthority, AuthorityLevel } from "../actions/authority.js";

export const CAPABILITY_PROFILES = ["observe", "review-block-only", "review"] as const;
export type CapabilityProfile = (typeof CAPABILITY_PROFILES)[number];

/** Bumped whenever a profile's ceiling or permissions change. */
export const PROFILE_SET_VERSION = "profiles-v1";

export const DEFAULT_PROFILE: CapabilityProfile = "observe";

export const PROFILE_CEILING: Readonly<Record<CapabilityProfile, ActionAuthority>> = {
  observe: { approve: "comment", requestChanges: "comment", requestHuman: "comment" },
  "review-block-only": { approve: "comment", requestChanges: "act", requestHuman: "act" },
  review: { approve: "act", requestChanges: "act", requestHuman: "act" },
};

export const PROFILE_LABEL: Readonly<Record<CapabilityProfile, string>> = {
  observe: "Observe",
  "review-block-only": "Review (block only)",
  review: "Review",
};

export const PROFILE_HINT: Readonly<Record<CapabilityProfile, string>> = {
  observe: "PullUp may only post its decision comment. It can never approve, request changes or request reviewers.",
  "review-block-only": "PullUp may request changes and ask humans, but can never approve.",
  review: "PullUp may approve, request changes and ask humans.",
};

/** GitHub App permission levels, as the installation-token API names them. */
export type GitHubPermissionLevel = "read" | "write";
export interface GitHubPermissions {
  readonly pull_requests?: GitHubPermissionLevel;
  readonly issues?: GitHubPermissionLevel;
  /** The PullUp check run (only when checks are enabled). */
  readonly checks?: GitHubPermissionLevel;
}

/** The kind of credential a live send would use. Only an App token can be narrowed. */
export type CredentialKind = "app" | "standing-token";

export function isCapabilityProfile(x: unknown): x is CapabilityProfile {
  return typeof x === "string" && (CAPABILITY_PROFILES as readonly string[]).includes(x);
}

/**
 * The minimum GitHub permissions one action needs at its effective level.
 * Every send reads the pull request first (guard) and after (verification);
 * the decision comment is an issue comment; reviews, reviewer requests and
 * dismissing PullUp's own stale block need pull-request write.
 */
export function requiredPermissions(level: AuthorityLevel, hasComment: boolean): GitHubPermissions {
  if (level === "off") return {};
  return {
    pull_requests: level === "act" ? "write" : "read",
    ...(hasComment ? { issues: "write" as const } : {}),
  };
}
