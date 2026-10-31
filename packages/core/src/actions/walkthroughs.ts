// Walkthrough links for PullUp's decision comment (config/walkthroughs.ts).
// Pure. Links are pinned to the head commit PullUp decided on, in two forms:
// diffmap's hosted viewer (works for public repositories; it reads GitHub
// without signing in) and the file on GitHub (works for private ones too).

import type { WalkthroughConfig } from "../config/walkthroughs.js";
import { DEFAULT_WALKTHROUGHS } from "../config/walkthroughs.js";
import { matchesAny } from "../policy/policy.js";

export interface WalkthroughLink {
  readonly path: string;
  readonly diffmapUrl: string;
  readonly githubUrl: string;
}

// File names come from the pull request author, so only plain names are
// linked; anything else could inject Markdown into PullUp's comment.
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const MARKDOWN = /\.(?:md|mdx)$/i;
const SHA = /^[0-9a-f]{7,40}$/i;

function safePath(path: string): boolean {
  if (!MARKDOWN.test(path)) return false;
  return path.split("/").every((s) => SEGMENT.test(s) && s !== "." && s !== "..");
}

/** The changed walkthrough files of one pull request, as links (empty when off or none). */
export function walkthroughLinks(
  repoId: string,
  headSha: string,
  files: readonly string[],
  config: WalkthroughConfig = DEFAULT_WALKTHROUGHS,
): WalkthroughLink[] {
  if (!config.enabled || !SHA.test(headSha)) return [];
  const [owner, repo] = repoId.split("/");
  if (!owner || !repo || !SEGMENT.test(owner) || !SEGMENT.test(repo)) return [];
  return [...new Set(files)]
    .filter((f) => safePath(f) && matchesAny(f, config.paths) !== null)
    .sort()
    .slice(0, config.maxLinks)
    .map((path) => ({
      path,
      diffmapUrl: `https://diffmap.dev/${owner}/${repo}/commit/${headSha}/${path}`,
      githubUrl: `https://github.com/${owner}/${repo}/blob/${headSha}/${path}`,
    }));
}

/** The walkthrough lines for a comment body (empty when there are none). */
export function walkthroughSection(links: readonly WalkthroughLink[]): string {
  if (links.length === 0) return "";
  const lines = links.map(
    (l) => `**Walkthrough:** \`${l.path}\` — [open in diffmap](${l.diffmapUrl}) · [view on GitHub](${l.githubUrl})`,
  );
  return `\n\n${lines.join("\n")}`;
}
