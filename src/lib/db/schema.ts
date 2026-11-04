export * from "./auth-schema";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Repositories PullUp has seen (created on the first webhook). `mode` is shadow until the owner turns it active. */
export const repos = sqliteTable("repos", {
  fullName: text("full_name").primaryKey(),
  mode: text("mode", { enum: ["shadow", "active"] }).notNull().default("shadow"),
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
    /** collecting → decided (pass / fail) or waiting (for a person); error when it could not be decided. */
    state: text("state", { enum: ["collecting", "decided", "waiting", "error"] }).notNull(),
    result: text("result", { enum: ["pass", "fail", "waiting"] }),
    /** Why the run ended as it did, after any person's answer or no-answer option. */
    reason: text("reason"),
    mode: text("mode", { enum: ["shadow", "active"] }).notNull(),
    /** The engine's full decision (questions, seats, quotes), as JSON. */
    decision: text("decision", { mode: "json" }),
    /** The config used for the decision (read from the default branch then), so later answers and deadlines use the same rules. */
    config: text("config", { mode: "json" }),
    notes: text("notes", { mode: "json" }).$type<string[]>().notNull().default([]),
    pending: text("pending", { mode: "json" }).$type<string[]>().notNull().default([]),
    councilCalls: integer("council_calls").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    error: text("error"),
    /** What happened to the check run: sent, or why not. */
    checkRun: text("check_run", { mode: "json" }),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    /** While set and in the future, one worker owns this run. */
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("runs_repo_sha").on(t.repo, t.headSha), index("runs_state").on(t.state)],
);

/** GitHub delivery ids already handled, so a redelivered webhook does nothing twice. */
export const deliveries = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  event: text("event").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
});

/** The hash-chained evidence record, one chain per repository. */
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

/** One person-ask per open question of a run: the engine's ask state and the WithAI questions sent for it. */
export const asks = sqliteTable(
  "asks",
  {
    runId: text("run_id").notNull(),
    questionId: text("question_id").notNull(),
    /** The engine's `AskState`. */
    state: text("state", { mode: "json" }).notNull(),
    /** WithAI questions sent, newest last: `{ id, to, open }`. */
    withai: text("withai", { mode: "json" }).$type<{ id: string; to: string; open: boolean }[]>().notNull().default([]),
    open: integer("open", { mode: "boolean" }).notNull().default(true),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.questionId] }), index("asks_open").on(t.open)],
);
