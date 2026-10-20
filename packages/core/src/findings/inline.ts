// Inline finding comments with a lifecycle (adapted from Warden's comment
// lifecycle): PullUp's located findings become review comments on the lines
// they concern; a finding that already has a comment is never posted twice;
// when a later push makes a finding go away, PullUp resolves its own thread.
//
// Information only: nothing here changes a decision or an action. Bodies are
// templates plus code facts (question id, path, lines, level, probability) —
// no model output, pull request text or owner free text. Pure: the existing
// comments come from the store (written only by the live actuator).

import type { InlineConfig } from "../config/inline.js";
import type { SeverityLevel } from "../config/severity.js";
import type { FindingCommentRecord, HunkRecord } from "../schema/domain.js";
import { sha256 } from "../signals/hunks.js";
import type { Finding } from "./findings.js";
import type { FindingLocation } from "./locations.js";
import { locateFinding } from "./locations.js";

export const FINDING_MARKER_PREFIX = "<!-- pullup:finding:v1:";

export const findingMarker = (key: string) => `${FINDING_MARKER_PREFIX}${key} -->`;

/** Stable across pushes: the same concern on the same file is the same comment. */
export function findingKey(findingId: string, path: string): string {
  return sha256(findingId, path).slice(0, 16);
}

/** What one question's "yes" means, in plain words. Wording edits don't change the question version. */
export const FINDING_COPY: Readonly<Record<string, { title: string; why: string }>> = {
  touchesAuthn: { title: "Possible change to how users or services sign in", why: "PullUp's risk signals rate this hunk as likely to change authentication (logins, sessions, tokens, keys)." },
  touchesAuthz: { title: "Possible change to an authorization check", why: "PullUp's risk signals rate this hunk as likely to change who may do what." },
  handlesSecrets: { title: "Possible handling of secrets", why: "PullUp's risk signals rate this hunk as likely to read, write, log or send secrets or credentials." },
  addsNetworkCall: { title: "Possible new outbound network call", why: "PullUp's risk signals rate this hunk as likely to add a call to an outside service." },
  changesDependencyManifest: { title: "Possible dependency change", why: "PullUp's risk signals rate this hunk as likely to add, remove or re-version a third-party dependency." },
  weakensInputValidation: { title: "Possible weaker input validation", why: "PullUp's risk signals rate this hunk as likely to remove or loosen validation or escaping of outside input." },
  removesErrorHandling: { title: "Possible removed error handling", why: "PullUp's risk signals rate this hunk as likely to remove error handling, retries or failure checks." },
  changesDbSchema: { title: "Possible database schema change", why: "PullUp's risk signals rate this hunk as likely to change a schema, a migration or the shape of stored data." },
  changesConcurrency: { title: "Possible concurrency change", why: "PullUp's risk signals rate this hunk as likely to change locking, transactions or shared state." },
};

const LEVEL_WORD: Record<SeverityLevel, string> = { p0: "P0", p1: "P1", p2: "P2" };
const LEVEL_RANK: Record<SeverityLevel, number> = { p0: 0, p1: 1, p2: 2 };

function copyFor(f: Finding): { title: string; why: string } {
  const q = f.id.replace(/^signal:/, "");
  if (FINDING_COPY[q]) return FINDING_COPY[q]!;
  if (q.startsWith("custom:")) return { title: f.title, why: "One of this repo's own risk questions answered yes for this hunk." };
  return { title: f.title, why: "PullUp's risk signals flagged this hunk." };
}

export interface InlineComment {
  readonly findingKey: string;
  readonly findingId: string;
  readonly level: SeverityLevel;
  readonly path: string;
  /** Multi-line comments set start_line; both on the RIGHT side. */
  readonly start_line?: number;
  readonly line: number;
  readonly side: "RIGHT";
  readonly start_side?: "RIGHT";
  readonly body: string;
}

export interface InlineResolve {
  readonly findingKey: string;
  readonly commentId: number;
  readonly path: string;
  /** Posted as a reply before resolving. */
  readonly reply: string;
  readonly why: "fixed" | "file-removed";
}

export interface InlinePlan {
  readonly post: readonly InlineComment[];
  readonly resolve: readonly InlineResolve[];
  /** Keys whose finding is still present and already has an open comment. */
  readonly keep: readonly string[];
  /** Why candidates weren't posted (cap, already resolved by a human, …), for the dashboard. */
  readonly notPosted: readonly { readonly findingKey: string; readonly findingId: string; readonly path: string; readonly reason: string }[];
}

export const EMPTY_INLINE_PLAN: InlinePlan = { post: [], resolve: [], keep: [], notPosted: [] };

function body(f: Finding, first: FindingLocation, rest: readonly FindingLocation[], key: string, headSha: string, questionSet: string | null): string {
  const c = copyFor(f);
  const p = /p=(\d\.\d+)/.exec(f.detail)?.[1];
  const observe = f.active ? "" : " · observe only";
  const also =
    rest.length > 0
      ? `\n\n<details><summary>Also flagged at ${rest.length} more place${rest.length === 1 ? "" : "s"}</summary>\n\n${rest
          .map((l) => `- \`${l.path}:${l.startLine}-${l.endLine}\``)
          .join("\n")}\n\n</details>`
      : "";
  const q = f.id.replace(/^signal:/, "");
  const v = f.verdict?.accepted && f.verdict.verdict === "confirmed" ? f.verdict : null;
  const evidence = v
    ? `\n\nChecked against the code: ${v.evidence.map((e) => `\`${e.path}:${e.line}\` ${"`"}${e.quote.replace(/`/g, "'")}${"`"}`).join("; ")}.${v.fix ? ` Suggested fix: ${v.fix}` : ""}`
    : "";
  return [
    `**${c.title}** · ${LEVEL_WORD[f.level]}${observe}${v ? " · confirmed" : ""}`,
    "",
    `${c.why.replace(/\.$/, "")}${p ? ` (\`${q}\`, ${p})` : ""}. A human should confirm the change is intended and safe.${evidence}${also}`,
    "",
    `<sub>PullUp${questionSet ? ` \`${questionSet}\`` : ""} · \`${f.id}\` · head \`${headSha.slice(0, 7)}\` · \`${first.path}:${first.startLine}\`</sub>`,
    findingMarker(key),
  ].join("\n");
}

export interface PlanInlineInput {
  readonly config: InlineConfig;
  /** All of this pull's findings (active or not) — "still present" ignores level and active filters. */
  readonly findings: readonly Finding[];
  /** This pull's hunks at the current head. */
  readonly hunks: readonly HunkRecord[];
  /** PullUp's stored comments for this pull. */
  readonly existing: readonly FindingCommentRecord[];
  readonly headSha: string;
  /** False when the signal layer didn't run (off): nothing is posted or resolved. */
  readonly signalsRan: boolean;
  readonly questionSet?: string | null;
}

/** What to post, keep and resolve for one pull at its current head. Pure. */
export function planInline(input: PlanInlineInput): InlinePlan {
  const { config, findings, hunks, existing, headSha } = input;
  if (!config.enabled || !input.signalsRan) return EMPTY_INLINE_PLAN;
  // An injection tripwire makes the pull request hostile by assumption: the decision comment is enough.
  if (findings.some((f) => f.kind === "injection")) return EMPTY_INLINE_PLAN;

  const filesInPull = new Set(hunks.map((h) => h.path));
  const unevaluatedPaths = new Set(
    findings.filter((f) => f.kind === "unevaluated").flatMap((f) => (f.units ?? []).map((u) => u.slice(0, u.lastIndexOf("#")))),
  );
  const byKey = new Map(existing.map((e) => [e.findingKey, e]));

  // Every located (finding, file) present now, whatever its level or active state.
  const present = new Map<string, { f: Finding; locs: FindingLocation[] }>();
  for (const f of findings) {
    if (f.source !== "signal" || f.kind === "unevaluated") continue;
    const byPath = new Map<string, FindingLocation[]>();
    for (const loc of locateFinding(f, hunks)) byPath.set(loc.path, [...(byPath.get(loc.path) ?? []), loc]);
    for (const [path, locs] of byPath) present.set(findingKey(f.id, path), { f, locs });
  }

  const post: InlineComment[] = [];
  const keep: string[] = [];
  const notPosted: Array<{ findingKey: string; findingId: string; path: string; reason: string }> = [];
  const candidates = [...present.entries()].sort(
    ([ka, a], [kb, b]) => LEVEL_RANK[a.f.level] - LEVEL_RANK[b.f.level] || a.locs[0]!.path.localeCompare(b.locs[0]!.path) || ka.localeCompare(kb),
  );
  for (const [key, { f, locs }] of candidates) {
    const prior = byKey.get(key);
    if (prior?.status === "open") {
      keep.push(key);
      continue;
    }
    if (LEVEL_RANK[f.level] > LEVEL_RANK[config.reportOn]) continue;
    if (!f.active && !config.includeObserve) continue;
    if (prior?.status === "resolved-by-human") {
      notPosted.push({ findingKey: key, findingId: f.id, path: locs[0]!.path, reason: "a human resolved PullUp's earlier comment on this finding" });
      continue;
    }
    const commentable = locs.filter((l) => l.inDiff);
    const first = commentable[0];
    if (!first) {
      notPosted.push({ findingKey: key, findingId: f.id, path: locs[0]!.path, reason: "no commentable diff line (deletion only)" });
      continue;
    }
    if (post.length >= config.maxComments) {
      notPosted.push({ findingKey: key, findingId: f.id, path: locs[0]!.path, reason: `over the limit of ${config.maxComments} new comments per commit` });
      continue;
    }
    const rest = locs.filter((l) => l !== first);
    post.push({
      findingKey: key,
      findingId: f.id,
      level: f.level,
      path: first.path,
      ...(first.endLine > first.startLine ? { start_line: first.startLine, start_side: "RIGHT" as const } : {}),
      line: first.endLine,
      side: "RIGHT",
      body: body(f, first, rest, key, headSha, input.questionSet ?? null),
    });
  }

  const resolve: InlineResolve[] = [];
  if (config.resolveFixed) {
    for (const e of existing) {
      if (e.status !== "open" || present.has(e.findingKey)) continue;
      if (resolve.length >= config.maxResolutions) break;
      const removed = !filesInPull.has(e.path);
      // Warden's guard: only resolve when the file was fully analysed this run.
      if (!removed && unevaluatedPaths.has(e.path)) continue;
      resolve.push({
        findingKey: e.findingKey,
        commentId: e.commentId,
        path: e.path,
        why: removed ? "file-removed" : "fixed",
        reply: removed
          ? `This file is no longer part of the pull request at \`${headSha.slice(0, 7)}\`. Resolved by PullUp.`
          : `No longer flagged at \`${headSha.slice(0, 7)}\`. Resolved by PullUp.`,
      });
    }
  }
  return { post, resolve, keep, notPosted };
}
