export * from "./auth-schema";
import type { Assessment, CheckMode, ConcernCase, HardFailure } from "@pullup/engine";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Repositories PullUp has seen. `checkMode` starts as Report only (the check
 * never blocks a merge) until the owner switches it to Enforce.
 */
export const repos = sqliteTable("repos", {
  fullName: text("full_name").primaryKey(),
  checkMode: text("check_mode", { enum: ["report_only", "enforce"] }).$type<CheckMode>().notNull().default("report_only"),
  /** Set for the demo repository fed by the synthetic generator. */
  synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** One row per commit PullUp decides on. */
export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    repo: text("repo").notNull(),
    headSha: text("head_sha").notNull(),
    pull: integer("pull"),
    title: text("title").notNull().default(""),
    /** collecting → decided, or waiting (for a person or a fact); error when it could not be decided. */
    state: text("state", { enum: ["collecting", "decided", "waiting", "error"] }).notNull(),
    result: text("result", { enum: ["pass", "fail", "waiting"] }),
    reason: text("reason"),
    checkMode: text("check_mode", { enum: ["report_only", "enforce"] }).$type<CheckMode>().notNull().default("report_only"),
    /** Which provider answered (`PULLUP_DECIDER`) and which agent harness ran. */
    decider: text("decider"),
    harness: text("harness"),
    hardFailures: text("hard_failures", { mode: "json" }).$type<HardFailure[]>().notNull().default([]),
    concerns: text("concerns", { mode: "json" }).$type<ConcernCase[]>().notNull().default([]),
    /** The agent's tool calls, for the run page. */
    agentSteps: text("agent_steps", { mode: "json" }).$type<Array<{ tool: string; summary: string; at: string }>>().notNull().default([]),
    /** Jobs and attempts as collected (no logs), for the run page. */
    ci: text("ci", { mode: "json" }).$type<Array<{ workflow: string; job: string; attempts: string[] }>>().notNull().default([]),
    /** The config used for the decision, so later answers use the same rules. */
    config: text("config", { mode: "json" }),
    notes: text("notes", { mode: "json" }).$type<string[]>().notNull().default([]),
    costUsd: real("cost_usd"),
    synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
    error: text("error"),
    checkRun: text("check_run", { mode: "json" }),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    rerunRequested: integer("rerun_requested", { mode: "boolean" }).notNull().default(false),
    /** Outcome facts: when the pull request merged, and whether it was reverted. */
    mergedAt: integer("merged_at", { mode: "timestamp_ms" }),
    revertedAt: integer("reverted_at", { mode: "timestamp_ms" }),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("runs_repo_sha").on(t.repo, t.headSha), index("runs_state").on(t.state), index("runs_pull").on(t.repo, t.pull)],
);

/** One assessment per flagged concern of a run: the typed answer and what became of it. */
export const assessments = sqliteTable(
  "assessments",
  {
    runId: text("run_id").notNull(),
    concern: text("concern").$type<Assessment["concern"]>().notNull(),
    provider: text("provider").notNull(),
    status: text("status").$type<Assessment["status"]>().notNull(),
    answer: text("answer").$type<Assessment["answer"]>(),
    final: integer("final", { mode: "boolean" }).notNull(),
    probability: real("probability"),
    citations: text("citations", { mode: "json" }).$type<Assessment["citations"]>().notNull().default([]),
    verified: text("verified", { mode: "json" }).$type<Assessment["verified"]>().notNull().default([]),
    synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
    decisionId: text("decision_id"),
    costUsd: real("cost_usd"),
    answeredBy: text("answered_by"),
    error: text("error"),
    inputRequest: text("input_request", { mode: "json" }).$type<{ field: string; question: string; expectedVersion: number } | null>(),
    /** The real outcome reported for this decision, and where it came from. */
    outcome: text("outcome", { enum: ["risky", "safe"] }),
    outcomeSource: text("outcome_source"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.concern] }), index("assessments_decision").on(t.decisionId)],
);

/** GitHub delivery ids already handled, so a redelivered webhook does nothing twice. */
export const deliveries = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  event: text("event").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
});

/** The hash-chained record, one chain per repository. */
export const evidence = sqliteTable(
  "evidence",
  {
    scope: text("scope").notNull(),
    seq: integer("seq").notNull(),
    runId: text("run_id").notNull(),
    kind: text("kind").notNull(),
    at: text("at").notNull(),
    payload: text("payload", { mode: "json" }),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.seq] }), index("evidence_run").on(t.runId)],
);

/** Used permit nonces: a permit works once. */
export const permitNonces = sqliteTable("permit_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: text("expires_at").notNull(),
});

/** Small switches: the stop switch (`stopped`). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});
