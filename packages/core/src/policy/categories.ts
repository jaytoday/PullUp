// "Always require a human for…" categories. One table shared by the engine and
// the settings UI, so "Auth code" means the same globs everywhere. Glob
// categories compile into the policy's requireHumanGlobs; rule categories are
// evaluated by guardrails (policy/guardrails.ts). Browser-safe.

export type RequireHumanCategory =
  | "ciWorkflows"
  | "reviewConfig"
  | "infrastructure"
  | "migrations"
  | "auth"
  | "secrets"
  | "containers"
  | "newDependencies"
  | "majorDependencyBumps"
  | "firstTimeContributors";

export interface CategorySpec {
  readonly id: RequireHumanCategory;
  readonly label: string;
  readonly help: string;
  /** Locked categories are always on — the schema rejects `false`. */
  readonly locked: boolean;
  readonly defaultOn: boolean;
  /** Path globs (glob categories) — empty for rule categories. */
  readonly globs: readonly string[];
  /** Rule categories are detected from the diff/history rather than paths. */
  readonly rule: boolean;
}

export const REQUIRE_HUMAN_CATEGORIES: readonly CategorySpec[] = [
  {
    id: "ciWorkflows",
    label: "CI workflows",
    help: "Workflow and action files run with repository secrets; a PR that edits them can exfiltrate them (\"pwn requests\").",
    locked: true,
    defaultOn: true,
    globs: [".github/workflows/**", ".github/actions/**"],
    rule: false,
  },
  {
    id: "reviewConfig",
    label: "Review & bot config",
    help: "CODEOWNERS, agent instruction files, and PullUp's own config steer reviewers — a PR must never rewrite the rules it's judged by.",
    locked: true,
    defaultOn: true,
    globs: [
      "CODEOWNERS",
      ".github/CODEOWNERS",
      "docs/CODEOWNERS",
      "pullup.config.json",
      "**/AGENTS.md",
      "**/CLAUDE.md",
      ".github/copilot-instructions.md",
      ".github/instructions/**",
      ".cursor/BUGBOT.md",
      ".coderabbit.yaml",
    ],
    rule: false,
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    help: "IaC and cloud permissions: a widened IAM policy or open security group is invisible to tests.",
    locked: false,
    defaultOn: true,
    globs: ["infra/**", "**/*.tf", "**/terraform/**"],
    rule: false,
  },
  {
    id: "migrations",
    label: "DB migrations",
    help: "Schema changes can lock tables or break readers still running the old code.",
    locked: false,
    defaultOn: true,
    globs: ["**/migrations/**"],
    rule: false,
  },
  {
    id: "auth",
    label: "Auth code",
    help: "Authentication and authorization modules decide who may do what.",
    locked: false,
    defaultOn: true,
    globs: ["**/auth/**"],
    rule: false,
  },
  {
    id: "secrets",
    label: "Secrets & env files",
    help: "Key material and environment files.",
    locked: false,
    defaultOn: true,
    globs: ["**/*.pem", "**/*.key", "**/.env*"],
    rule: false,
  },
  {
    id: "containers",
    label: "Dockerfiles",
    help: "Base image and container user changes.",
    locked: false,
    defaultOn: true,
    globs: ["**/Dockerfile", "**/Dockerfile.*"],
    rule: false,
  },
  {
    id: "newDependencies",
    label: "New dependencies",
    help: "Adding a direct dependency is an architectural decision and runs third-party code.",
    locked: true,
    defaultOn: true,
    globs: [],
    rule: true,
  },
  {
    id: "majorDependencyBumps",
    label: "Major dependency bumps",
    help: "A semver-major update may change behaviour your tests don't cover.",
    locked: false,
    defaultOn: true,
    globs: [],
    rule: true,
  },
  {
    id: "firstTimeContributors",
    label: "First-time contributors",
    help: "Authors with no merged PR in this repo yet are never bot-approved.",
    locked: true,
    defaultOn: true,
    globs: [],
    rule: true,
  },
];

export const CATEGORY_IDS = REQUIRE_HUMAN_CATEGORIES.map((c) => c.id) as readonly RequireHumanCategory[];

export function categorySpec(id: RequireHumanCategory): CategorySpec {
  return REQUIRE_HUMAN_CATEGORIES.find((c) => c.id === id)!;
}

/** Resolved on/off per category, with locked categories forced on. */
export function resolveCategories(
  file: Partial<Record<RequireHumanCategory, boolean>> = {},
): Record<RequireHumanCategory, boolean> {
  const out = {} as Record<RequireHumanCategory, boolean>;
  for (const c of REQUIRE_HUMAN_CATEGORIES) out[c.id] = c.locked ? true : (file[c.id] ?? c.defaultOn);
  return out;
}

export function categoryGlobs(enabled: Readonly<Record<RequireHumanCategory, boolean>>): string[] {
  return REQUIRE_HUMAN_CATEGORIES.filter((c) => enabled[c.id]).flatMap((c) => c.globs);
}

/** Which glob category a path falls in (for readable hit labels), if any. */
export function categoryForGlob(glob: string): CategorySpec | null {
  return REQUIRE_HUMAN_CATEGORIES.find((c) => c.globs.includes(glob)) ?? null;
}
