// Agent identity (Agent Baseline DIS-01, DIS-05). An agent's *version* is a
// composition hash over everything that shapes what it does: its instructions
// and tool sources (for the Eve agent), the @pullup/core version, the base Jev
// question-set version and the model id. Editing any of them is a new identity
// for authorization purposes: the new hash starts `pending` (comment only)
// until an operator approves it.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../signals/hunks.js";
import { QUESTION_SET_V1 } from "../signals/questions/v1.js";
import { canonicalJson } from "../config/schema.js";

export const AGENT_IDS = {
  eve: "pullup/eve",
  cli: "pullup/cli",
  dashboard: "pullup/dashboard",
} as const;

export interface AgentIdentity {
  readonly id: string;
  /** Composition hash; "unknown" when it could not be computed (fails closed). */
  readonly version: string;
  /** The hashed inputs (file contents replaced by their hashes). */
  readonly inputs: Readonly<Record<string, string>>;
}

export const UNKNOWN_VERSION = "unknown";

/**
 * The @pullup/core version, as a constant rather than read from package.json
 * at run time: inside eve's bundle the module no longer sits next to
 * package.json, the read failed, and the Eve agent hashed as a different
 * version ("unknown" core) than `pullup agents` showed for this checkout, so
 * approving the listed hash never let the running agent act. A test keeps
 * this equal to package.json.
 */
export const CORE_VERSION = "0.1.0";

/**
 * The composition hash for one agent. `files` maps a path to its source text
 * (the Eve agent's instructions and tools); CLI and dashboard pass none.
 */
export function agentIdentity(input: {
  readonly id: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly modelId?: string | null;
  readonly questionSetVersion?: string;
  readonly coreVersion?: string;
}): AgentIdentity {
  const inputs: Record<string, string> = {
    agentId: input.id,
    coreVersion: input.coreVersion ?? CORE_VERSION,
    questionSet: input.questionSetVersion ?? QUESTION_SET_V1.version,
    model: input.modelId ?? "none",
  };
  for (const [path, text] of Object.entries(input.files ?? {})) inputs[`file:${path}`] = sha256(text);
  return { id: input.id, version: sha256(canonicalJson(inputs)).slice(0, 16), inputs };
}

/** Short form for display and CLI matching. */
export function shortVersion(version: string): string {
  return version.slice(0, 8);
}

/** The Eve agent's default model (agent/agent.ts reads it from here so the hash and the agent agree). */
export const DEFAULT_EVE_MODEL = "claude-sonnet-4-6";

/**
 * The Eve agent's identity, from its sources under `<root>/agent`: agent.ts,
 * instructions.ts and every tool file. Unreadable sources → version "unknown",
 * which the authorizer denies (fail closed).
 */
export function eveAgentIdentity(root: string, env: Readonly<Record<string, string | undefined>> = process.env): AgentIdentity {
  const modelId = env.PULLUP_MODEL || DEFAULT_EVE_MODEL;
  try {
    const dir = join(root, "agent");
    const files: Record<string, string> = {
      "agent/agent.ts": readFileSync(join(dir, "agent.ts"), "utf8"),
      "agent/instructions.ts": readFileSync(join(dir, "instructions.ts"), "utf8"),
    };
    for (const f of readdirSync(join(dir, "tools")).filter((f) => f.endsWith(".ts")).sort()) {
      files[`agent/tools/${f}`] = readFileSync(join(dir, "tools", f), "utf8");
    }
    return agentIdentity({ id: AGENT_IDS.eve, files, modelId });
  } catch {
    return { id: AGENT_IDS.eve, version: UNKNOWN_VERSION, inputs: { error: "agent sources unreadable" } };
  }
}
