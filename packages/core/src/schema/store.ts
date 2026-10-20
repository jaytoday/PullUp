// The persistence seam `@pullup/core` depends on. Implementations: `@pullup/db`
// (SQLite via libsql + drizzle, and an in-memory store for fixtures/tests).
//
// Every method is async so the SQLite implementation can be; the in-memory
// implementation simply resolves. Upserts are idempotent on primary keys.

import type { ReviewActionRecord } from "../actions/review.js";
import type { ConfigFile } from "../config/schema.js";
import type { SignalRecord, SignalRunRecord } from "../signals/types.js";
import type { VerdictRecord, VerifyRunRecord } from "../verify/types.js";
import type { LearningDismissal } from "../outcomes/learn.js";
import type {
  AgentRecord,
  ControlState,
  EvidenceQuery,
  EvidenceRecord,
  RepoEnrollment,
} from "../authority/records.js";
import type {
  DefectEventRecord,
  FindingCommentRecord,
  HunkRecord,
  PullRecord,
  RepositoryRecord,
  ReviewCommentRecord,
  ReviewRecord,
} from "./domain.js";

export interface PullStore {
  readonly kind: "memory" | "sqlite";

  upsertRepository(repo: RepositoryRecord): Promise<void>;
  getRepository(repoId: string): Promise<RepositoryRecord | null>;

  upsertPull(pull: PullRecord): Promise<void>;
  getPull(repoId: string, number: number): Promise<PullRecord | null>;

  upsertReview(review: ReviewRecord): Promise<void>;
  upsertReviewComment(comment: ReviewCommentRecord): Promise<void>;
  upsertDefectEvent(event: DefectEventRecord): Promise<void>;

  listPulls(repoId: string): Promise<PullRecord[]>;
  listMergedPulls(repoId: string): Promise<PullRecord[]>;
  listReviews(repoId: string, pullNumber?: number): Promise<ReviewRecord[]>;
  listReviewComments(repoId: string, pullNumber?: number): Promise<ReviewCommentRecord[]>;
  listDefectEvents(repoId: string, pullNumber?: number): Promise<DefectEventRecord[]>;

  /** Repositories that have been ingested at least once. */
  listRepositories(): Promise<string[]>;

  /** Replaces all hunks of one pull (a re-push can shrink the hunk list). */
  replaceHunks(repoId: string, pullNumber: number, hunks: readonly HunkRecord[]): Promise<void>;
  listHunks(repoId: string, pullNumber?: number): Promise<HunkRecord[]>;

  /** Content-addressed signal cache. */
  getSignal(cacheKey: string): Promise<SignalRecord | null>;
  upsertSignal(signal: SignalRecord): Promise<void>;
  recordSignalRun(run: SignalRunRecord): Promise<void>;
  listSignalRuns(repoId: string): Promise<SignalRunRecord[]>;

  /** Bot review actions (logged, not sent — see actions/review.ts). */
  recordReviewAction(action: ReviewActionRecord): Promise<void>;
  listReviewActions(repoId: string, pullNumber?: number): Promise<ReviewActionRecord[]>;

  /** PullUp's own inline finding comments, keyed by (repo, pull, finding key). */
  upsertFindingComment(rec: FindingCommentRecord): Promise<void>;
  listFindingComments(repoId: string, pullNumber?: number): Promise<FindingCommentRecord[]>;

  /** Evidence-verifier verdict cache (content-addressed) and run log. */
  getVerdict(cacheKey: string): Promise<VerdictRecord | null>;
  upsertVerdict(rec: VerdictRecord): Promise<void>;
  listVerdicts(repoId: string, pullNumber?: number): Promise<VerdictRecord[]>;
  recordVerifyRun(run: VerifyRunRecord): Promise<void>;
  listVerifyRuns(repoId: string): Promise<VerifyRunRecord[]>;

  /** Learnings an operator dismissed (append-only). */
  appendLearningDismissal(d: LearningDismissal): Promise<void>;
  listLearningDismissals(repoId: string): Promise<LearningDismissal[]>;

  /** Append-only per-repo config versions (the "repo" config layer), oldest first. */
  listConfigVersions(repoId: string): Promise<ConfigVersionRecord[]>;
  /** Appends a version, numbering it max+1. Throws if `expectedPrevious` isn't the latest. */
  appendConfigVersion(rec: NewConfigVersion, expectedPrevious: number | null): Promise<ConfigVersionRecord>;

  /** Authority layer (authority/): stop switch, enrollment, agent registry, permits, evidence. */
  getControlState(scope: string): Promise<ControlState | null>;
  setControlState(state: ControlState): Promise<void>;
  getEnrollment(repoId: string): Promise<RepoEnrollment | null>;
  setEnrollment(e: RepoEnrollment): Promise<void>;
  getAgent(agentId: string, version: string): Promise<AgentRecord | null>;
  upsertAgent(rec: AgentRecord): Promise<void>;
  listAgents(): Promise<AgentRecord[]>;
  /** Records a permit nonce as used. False if it was already used (replay). */
  consumePermitNonce(nonce: string, taskId: string, at: string): Promise<boolean>;
  /** The newest evidence row of one repo's chain. */
  lastEvidence(repoId: string): Promise<EvidenceRecord | null>;
  /** Inserts one row; throws if (repoId, seq) already exists. Never updates. */
  insertEvidence(rec: EvidenceRecord): Promise<void>;
  /** Matching rows, ordered by repo then seq. */
  listEvidence(q?: EvidenceQuery): Promise<EvidenceRecord[]>;
}

export interface ConfigVersionRecord {
  readonly repoId: string;
  readonly version: number;
  /** The repo layer only (partial config), not the resolved config. */
  readonly config: ConfigFile;
  /** sha256 of the canonical effective config at save time. */
  readonly hash: string;
  readonly note: string;
  /** Field paths flagged as loosening the gate. */
  readonly loosened: readonly string[];
  readonly author: string;
  readonly createdAt: string;
  /** Set when this version restores an earlier one. */
  readonly restoredFrom: number | null;
}

export type NewConfigVersion = Omit<ConfigVersionRecord, "version">;

export class ConfigVersionConflictError extends Error {
  constructor(
    readonly expected: number | null,
    readonly actual: number | null,
  ) {
    super(`Config changed since you loaded it (expected v${expected ?? 0}, latest is v${actual ?? 0}).`);
  }
}

/** In-memory PullStore for fixtures, tests, and the offline CLI default. */
export class InMemoryStore implements PullStore {
  readonly kind = "memory" as const;
  private repositories = new Map<string, RepositoryRecord>();
  private pulls = new Map<string, PullRecord>();
  private reviews = new Map<string, ReviewRecord>();
  private comments = new Map<string, ReviewCommentRecord>();
  private defects = new Map<string, DefectEventRecord>();
  private hunks = new Map<string, HunkRecord[]>();
  private signals = new Map<string, SignalRecord>();
  private signalRuns: SignalRunRecord[] = [];
  private reviewActions = new Map<string, ReviewActionRecord>();
  private findingComments = new Map<string, FindingCommentRecord>();
  private verdicts = new Map<string, VerdictRecord>();
  private verifyRuns: VerifyRunRecord[] = [];
  private dismissals: LearningDismissal[] = [];
  private configVersions: ConfigVersionRecord[] = [];
  private controlStates = new Map<string, ControlState>();
  private enrollments = new Map<string, RepoEnrollment>();
  private agents = new Map<string, AgentRecord>();
  private nonces = new Set<string>();
  private evidence: EvidenceRecord[] = [];

  private keyPull(repoId: string, number: number): string {
    return `${repoId}#${number}`;
  }

  private keyReview(repoId: string, pullNumber: number, id: number): string {
    return `${repoId}#${pullNumber}#${id}`;
  }

  private keyDefect(event: DefectEventRecord): string {
    return `${event.repoId}#${event.pullNumber}#${event.kind}#${event.at}`;
  }

  async upsertRepository(repo: RepositoryRecord): Promise<void> {
    this.repositories.set(repo.repoId, repo);
  }

  async getRepository(repoId: string): Promise<RepositoryRecord | null> {
    return this.repositories.get(repoId) ?? null;
  }

  async upsertPull(pull: PullRecord): Promise<void> {
    this.pulls.set(this.keyPull(pull.repoId, pull.number), pull);
  }

  async getPull(repoId: string, number: number): Promise<PullRecord | null> {
    return this.pulls.get(this.keyPull(repoId, number)) ?? null;
  }

  async upsertReview(review: ReviewRecord): Promise<void> {
    this.reviews.set(this.keyReview(review.repoId, review.pullNumber, review.id), review);
  }

  async upsertReviewComment(comment: ReviewCommentRecord): Promise<void> {
    this.comments.set(this.keyReview(comment.repoId, comment.pullNumber, comment.id), comment);
  }

  async upsertDefectEvent(event: DefectEventRecord): Promise<void> {
    this.defects.set(this.keyDefect(event), event);
  }

  async listPulls(repoId: string): Promise<PullRecord[]> {
    return [...this.pulls.values()].filter((p) => p.repoId === repoId);
  }

  async listMergedPulls(repoId: string): Promise<PullRecord[]> {
    return (await this.listPulls(repoId)).filter((p) => p.state === "merged");
  }

  async listReviews(repoId: string, pullNumber?: number): Promise<ReviewRecord[]> {
    return [...this.reviews.values()].filter(
      (r) => r.repoId === repoId && (pullNumber === undefined || r.pullNumber === pullNumber),
    );
  }

  async listReviewComments(repoId: string, pullNumber?: number): Promise<ReviewCommentRecord[]> {
    return [...this.comments.values()].filter(
      (c) => c.repoId === repoId && (pullNumber === undefined || c.pullNumber === pullNumber),
    );
  }

  async listDefectEvents(repoId: string, pullNumber?: number): Promise<DefectEventRecord[]> {
    return [...this.defects.values()].filter(
      (d) => d.repoId === repoId && (pullNumber === undefined || d.pullNumber === pullNumber),
    );
  }

  async listRepositories(): Promise<string[]> {
    return [...this.repositories.keys()];
  }

  async replaceHunks(repoId: string, pullNumber: number, hunks: readonly HunkRecord[]): Promise<void> {
    this.hunks.set(this.keyPull(repoId, pullNumber), [...hunks]);
  }

  async listHunks(repoId: string, pullNumber?: number): Promise<HunkRecord[]> {
    if (pullNumber !== undefined) return [...(this.hunks.get(this.keyPull(repoId, pullNumber)) ?? [])];
    return [...this.hunks.values()].flat().filter((h) => h.repoId === repoId);
  }

  async getSignal(cacheKey: string): Promise<SignalRecord | null> {
    return this.signals.get(cacheKey) ?? null;
  }

  async upsertSignal(signal: SignalRecord): Promise<void> {
    this.signals.set(signal.cacheKey, signal);
  }

  async recordSignalRun(run: SignalRunRecord): Promise<void> {
    this.signalRuns.push(run);
  }

  async listSignalRuns(repoId: string): Promise<SignalRunRecord[]> {
    return this.signalRuns.filter((r) => r.repoId === repoId);
  }

  async recordReviewAction(action: ReviewActionRecord): Promise<void> {
    this.reviewActions.set(reviewActionKey(action), action);
  }

  async listReviewActions(repoId: string, pullNumber?: number): Promise<ReviewActionRecord[]> {
    return [...this.reviewActions.values()].filter(
      (a) => a.repoId === repoId && (pullNumber === undefined || a.pullNumber === pullNumber),
    );
  }

  async upsertFindingComment(rec: FindingCommentRecord): Promise<void> {
    this.findingComments.set(`${rec.repoId}#${rec.pullNumber}#${rec.findingKey}`, rec);
  }

  async listFindingComments(repoId: string, pullNumber?: number): Promise<FindingCommentRecord[]> {
    return [...this.findingComments.values()].filter(
      (c) => c.repoId === repoId && (pullNumber === undefined || c.pullNumber === pullNumber),
    );
  }

  async getVerdict(cacheKey: string): Promise<VerdictRecord | null> {
    return this.verdicts.get(cacheKey) ?? null;
  }

  async upsertVerdict(rec: VerdictRecord): Promise<void> {
    this.verdicts.set(rec.cacheKey, rec);
  }

  async listVerdicts(repoId: string, pullNumber?: number): Promise<VerdictRecord[]> {
    return [...this.verdicts.values()].filter((v) => v.repoId === repoId && (pullNumber === undefined || v.pullNumber === pullNumber));
  }

  async recordVerifyRun(run: VerifyRunRecord): Promise<void> {
    this.verifyRuns.push(run);
  }

  async listVerifyRuns(repoId: string): Promise<VerifyRunRecord[]> {
    return this.verifyRuns.filter((r) => r.repoId === repoId);
  }

  async appendLearningDismissal(d: LearningDismissal): Promise<void> {
    this.dismissals.push(d);
  }

  async listLearningDismissals(repoId: string): Promise<LearningDismissal[]> {
    return this.dismissals.filter((d) => d.repoId === repoId);
  }

  async listConfigVersions(repoId: string): Promise<ConfigVersionRecord[]> {
    return this.configVersions.filter((v) => v.repoId === repoId);
  }

  async appendConfigVersion(rec: NewConfigVersion, expectedPrevious: number | null): Promise<ConfigVersionRecord> {
    const latest = (await this.listConfigVersions(rec.repoId)).at(-1)?.version ?? null;
    if (latest !== expectedPrevious) throw new ConfigVersionConflictError(expectedPrevious, latest);
    const saved: ConfigVersionRecord = { ...rec, version: (latest ?? 0) + 1 };
    this.configVersions.push(saved);
    return saved;
  }

  async getControlState(scope: string): Promise<ControlState | null> {
    return this.controlStates.get(scope) ?? null;
  }

  async setControlState(state: ControlState): Promise<void> {
    this.controlStates.set(state.scope, state);
  }

  async getEnrollment(repoId: string): Promise<RepoEnrollment | null> {
    return this.enrollments.get(repoId) ?? null;
  }

  async setEnrollment(e: RepoEnrollment): Promise<void> {
    this.enrollments.set(e.repoId, e);
  }

  async getAgent(agentId: string, version: string): Promise<AgentRecord | null> {
    return this.agents.get(`${agentId}@${version}`) ?? null;
  }

  async upsertAgent(rec: AgentRecord): Promise<void> {
    this.agents.set(`${rec.agentId}@${rec.version}`, rec);
  }

  async listAgents(): Promise<AgentRecord[]> {
    return [...this.agents.values()].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
  }

  async consumePermitNonce(nonce: string): Promise<boolean> {
    if (this.nonces.has(nonce)) return false;
    this.nonces.add(nonce);
    return true;
  }

  async lastEvidence(repoId: string): Promise<EvidenceRecord | null> {
    return this.evidence.filter((e) => e.repoId === repoId).at(-1) ?? null;
  }

  async insertEvidence(rec: EvidenceRecord): Promise<void> {
    if (this.evidence.some((e) => e.repoId === rec.repoId && e.seq === rec.seq)) {
      throw new Error(`Evidence row ${rec.repoId}#${rec.seq} already exists.`);
    }
    this.evidence.push(rec);
  }

  async listEvidence(q: EvidenceQuery = {}): Promise<EvidenceRecord[]> {
    return this.evidence
      .filter(
        (e) =>
          (q.repoId === undefined || e.repoId === q.repoId) &&
          (q.taskId === undefined || e.taskId === q.taskId) &&
          (q.agentVersion === undefined || e.agentVersion === q.agentVersion),
      )
      .sort((a, b) => a.repoId.localeCompare(b.repoId) || a.seq - b.seq);
  }

  /** Test hook: tamper with stored evidence (the chain check must catch it). */
  tamperEvidence(fn: (rows: EvidenceRecord[]) => EvidenceRecord[]): void {
    this.evidence = fn(this.evidence);
  }
}

/** Idempotency key for a review action: one per pull × head commit × action. */
export function reviewActionKey(a: Pick<ReviewActionRecord, "repoId" | "pullNumber" | "headSha" | "action">): string {
  return `${a.repoId}#${a.pullNumber}#${a.headSha}#${a.action}`;
}
