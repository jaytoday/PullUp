// `globToRegExp` and `matchesAny` copied from PullUp (code/pullup) packages/core/src/policy/policy.ts
// at commit a399ffc; the sensitive categories are trimmed from packages/core/src/policy/categories.ts
// to the plan's list.

/** Minimal glob → RegExp: `**` spans directories, `*` stays within one segment. */
function globToRegExp(glob: string): RegExp {
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

/** Changes that are hardest to undo. By default a person decides on them. */
export const SENSITIVE_CATEGORIES = {
  auth: { label: "Sign-in and permissions", globs: ["**/auth/**", "**/permissions/**", "**/*permission*.*"] },
  migrations: { label: "Database migrations", globs: ["**/migrations/**", "**/migrate/**"] },
  payments: { label: "Payment code", globs: ["**/payments/**", "**/billing/**", "**/*payment*.*"] },
  secrets: { label: "Secrets and environment files", globs: ["**/*.pem", "**/*.key", "**/.env*"] },
  ci: { label: "CI configuration", globs: [".github/workflows/**", ".github/actions/**", ".pullup/**"] },
} as const;
export type SensitiveCategory = keyof typeof SENSITIVE_CATEGORIES;

/** Test files, from PullUp's low-risk "test" list. */
export const TEST_GLOBS = ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "test/**", "tests/**", "**/test_*.py", "**/*_test.go"];
export const SNAPSHOT_GLOBS = ["**/__snapshots__/**", "**/*.snap"];
