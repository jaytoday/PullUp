// Runs a preview: PullUp's decision for a local branch, through the same core
// calls as a real pull request (ingest, signals, guardrails, findings, the
// two-cost decision, planReviewActions) on an overlay store, so nothing is
// written to the real history except cached signal answers. Number 0 is the
// synthetic pull request: GitHub never uses it.

import type { ActionAuthority } from "../actions/authority.js";
import { planReviewActions } from "../actions/review.js";
import { configReportOptions } from "../config/config.js";
import type { ResolvedConfig } from "../config/schema.js";
import { ingestRepo } from "../ingest/pipeline.js";
import type { PullSource, SourcePull } from "../ingest/source.js";
import { buildReport } from "../report/build.js";
import type { PullStore } from "../schema/store.js";
import type { JevRuntime } from "../signals/runtime.js";
import { diffHunks, parseGitDiff } from "./diff.js";
import { createOverlayStore } from "./overlay-store.js";
import type { PreviewResult } from "./result.js";
import { previewResult } from "./result.js";

export const PREVIEW_PULL_NUMBER = 0;
/** The author used when none is known; trusted so the first-time-contributor rule can't fire on a guess. */
export const UNKNOWN_PREVIEW_AUTHOR = "pullup-preview-author";

export interface PreviewInput {
  readonly store: PullStore;
  readonly repoId: string;
  readonly cfg: ResolvedConfig;
  readonly diff: string;
  readonly base: string;
  readonly head: string;
  readonly headSha: string;
  readonly author?: string | null;
  readonly labels?: readonly string[];
  /** Mark the change as AI-authored (adds the `ai-generated` label). */
  readonly ai?: boolean;
  readonly now?: string;
  readonly title?: string;
  /** Prepares the Jev runtime on the overlay store for pull 0 (evaluating signals); null when signals are off. */
  readonly prepareJev: (store: PullStore, pullNumbers: readonly number[]) => Promise<{ runtime: JevRuntime | null; notes: readonly string[] }>;
  readonly approval: { readonly unlocked: boolean; readonly reason: string | null };
}

export async function runPreview(input: PreviewInput): Promise<{ result: PreviewResult; store: PullStore }> {
  const now = input.now ?? new Date().toISOString();
  const files = parseGitDiff(input.diff);
  const notes: string[] = [];
  const author = input.author?.trim() || UNKNOWN_PREVIEW_AUTHOR;
  let cfg = input.cfg;
  if (author === UNKNOWN_PREVIEW_AUTHOR) {
    notes.push("Author unknown (pass --author): the first-time-contributor rule was not applied.");
    cfg = { ...cfg, guardrails: { ...cfg.guardrails, authors: { ...cfg.guardrails.authors, trustedBots: [...cfg.guardrails.authors.trustedBots, UNKNOWN_PREVIEW_AUTHOR] } } };
  }
  const labels = [...new Set([...(input.labels ?? []), ...(input.ai ? ["ai-generated"] : [])])];
  const sp: SourcePull = {
    number: PREVIEW_PULL_NUMBER,
    title: input.title ?? `Preview of ${input.head}`,
    author,
    createdAt: now,
    closedAt: null,
    mergedAt: null,
    state: "open",
    baseBranch: input.base,
    headSha: input.headSha,
    additions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
    changedFiles: files.length,
    labels,
    draft: false,
    files: files.map((f) => f.path),
    hunks: diffHunks(files),
  };
  const overlay = createOverlayStore(input.store);
  const existing = await input.store.getRepository(input.repoId);
  const [owner, repo] = input.repoId.split("/") as [string, string];
  const source: PullSource = {
    repoId: input.repoId,
    readRepository: async () => ({ owner, repo, defaultBranch: existing?.defaultBranch ?? input.base }),
    listPulls: async () => [sp],
    listReviews: async () => [],
    listReviewComments: async () => [],
    listDefectEvents: async () => [],
  };
  await ingestRepo(source, overlay, { now });
  const { runtime, notes: jevNotes } = await input.prepareJev(overlay, [PREVIEW_PULL_NUMBER]);
  notes.push(...jevNotes);
  const report = await buildReport(overlay, input.repoId, cfg.priors, { now, jev: runtime ?? undefined, ...configReportOptions(cfg) });
  const decision = report.decisions.find((d) => d.pullNumber === PREVIEW_PULL_NUMBER);
  if (!decision) throw new Error("The preview produced no decision.");
  const [planned] = planReviewActions([decision], [{ number: PREVIEW_PULL_NUMBER, headSha: input.headSha }], {
    repoId: input.repoId,
    humanReviewers: cfg.jev.humanReviewers,
    authority: cfg.authority as ActionAuthority,
    configVersion: cfg.version,
    approvalUnlocked: input.approval.unlocked,
    ...(input.approval.reason ? { approvalLockedReason: input.approval.reason } : {}),
  });
  if (!report.risk && cfg.jev.mode === "off") notes.push("Risk signals are off for this repo.");
  const result = previewResult({
    repoId: input.repoId,
    base: input.base,
    head: input.head,
    headSha: input.headSha,
    files: sp.changedFiles,
    additions: sp.additions,
    deletions: sp.deletions,
    decision,
    planned: planned ?? null,
    model: runtime?.modelId ?? null,
    questionSet: runtime?.qs.version ?? null,
    mergedPulls: (await input.store.listMergedPulls(input.repoId)).length,
    notes,
  });
  return { result, store: overlay };
}
