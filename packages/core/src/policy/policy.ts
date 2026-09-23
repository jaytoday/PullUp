// Deterministic policy layer — runs before (and is authoritative over) any
// model signal. Path globs decide whether a change always needs a human and
// whether it falls in an allowlisted low-risk category. No model result can
// clear a `requiresHuman` hit.

export type AllowlistCategory = "docs" | "test";

export interface PolicyRules {
  /** Any changed path matching one of these → requiresHuman. */
  readonly requireHumanGlobs: readonly string[];
  /** A lockfile changed without its manifest → requiresHuman. */
  readonly lockfileWithoutManifest: boolean;
  /** Allowlisted low-risk categories: every changed path must match. */
  readonly allowlist: Readonly<Record<AllowlistCategory, readonly string[]>>;
}

export const DEFAULT_POLICY: PolicyRules = {
  requireHumanGlobs: [
    ".github/workflows/**",
    ".github/actions/**",
    "infra/**",
    "**/migrations/**",
    "**/auth/**",
    "**/*.pem",
    "**/.env*",
    "**/Dockerfile",
    "CODEOWNERS",
    ".github/CODEOWNERS",
  ],
  lockfileWithoutManifest: true,
  allowlist: {
    docs: ["docs/**", "**/*.md", "**/*.mdx"],
    test: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "test/**", "tests/**"],
  },
};

export interface PolicyHit {
  readonly rule: string;
  readonly path: string;
}

export interface PolicyResult {
  readonly requiresHuman: boolean;
  readonly hits: readonly PolicyHit[];
  /** Allowlisted category when *every* path matches it, else null. */
  readonly category: AllowlistCategory | null;
}

const LOCKFILES: Readonly<Record<string, string>> = {
  "pnpm-lock.yaml": "package.json",
  "package-lock.json": "package.json",
  "yarn.lock": "package.json",
  "bun.lockb": "package.json",
  "Cargo.lock": "Cargo.toml",
  "poetry.lock": "pyproject.toml",
  "Gemfile.lock": "Gemfile",
  "go.sum": "go.mod",
};

/** Minimal glob → RegExp: `**` spans directories, `*` stays within one segment. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero or more directories; a trailing `**` matches anything.
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, globs: readonly string[]): string | null {
  for (const g of globs) if (globToRegExp(g).test(path)) return g;
  return null;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i + 1);
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function evaluatePolicy(
  files: readonly string[],
  rules: PolicyRules = DEFAULT_POLICY,
): PolicyResult {
  const hits: PolicyHit[] = [];
  for (const path of files) {
    const g = matchesAny(path, rules.requireHumanGlobs);
    if (g) hits.push({ rule: g, path });
  }
  if (rules.lockfileWithoutManifest) {
    const fileSet = new Set(files);
    for (const path of files) {
      const manifest = LOCKFILES[baseOf(path)];
      if (manifest && !fileSet.has(dirOf(path) + manifest)) {
        hits.push({ rule: "lockfile-without-manifest", path });
      }
    }
  }
  let category: AllowlistCategory | null = null;
  if (files.length > 0) {
    for (const cat of Object.keys(rules.allowlist) as AllowlistCategory[]) {
      if (files.every((f) => matchesAny(f, rules.allowlist[cat]) !== null)) {
        category = cat;
        break;
      }
    }
  }
  return { requiresHuman: hits.length > 0, hits, category };
}
