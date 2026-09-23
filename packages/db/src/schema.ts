// Drizzle schema for the SQLite store. Mirrors @pullup/core domain records;
// booleans as 0/1 integers, string arrays as JSON blobs.

import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const repositories = sqliteTable("repositories", {
  repoId: text("repo_id").primaryKey(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  defaultBranch: text("default_branch").notNull(),
  ingestedAt: text("ingested_at").notNull(),
});

export const pulls = sqliteTable(
  "pulls",
  {
    repoId: text("repo_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    createdAt: text("created_at").notNull(),
    closedAt: text("closed_at"),
    mergedAt: text("merged_at"),
    state: text("state").notNull(),
    baseBranch: text("base_branch").notNull(),
    headSha: text("head_sha").notNull(),
    additions: integer("additions").notNull(),
    deletions: integer("deletions").notNull(),
    changedFiles: integer("changed_files").notNull(),
    labels: text("labels").notNull(),
    draft: integer("draft").notNull(),
    files: text("files").notNull(),
    changeType: text("change_type").notNull(),
    area: text("area").notNull(),
    sizeBucket: text("size_bucket").notNull(),
    defectProxy: text("defect_proxy"),
    firstReviewRequestedAt: text("first_review_requested_at"),
    firstHumanReviewAt: text("first_human_review_at"),
    reviewCompletedAt: text("review_completed_at"),
    reviewHours: real("review_hours"),
    totalReviewHours: real("total_review_hours"),
    reviewOutcome: text("review_outcome").notNull(),
    hadFindings: integer("had_findings").notNull(),
    reviewCount: integer("review_count").notNull(),
    commentCount: integer("comment_count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.number] })],
);

export const reviews = sqliteTable(
  "reviews",
  {
    repoId: text("repo_id").notNull(),
    pullNumber: integer("pull_number").notNull(),
    id: integer("id").notNull(),
    author: text("author").notNull(),
    submittedAt: text("submitted_at").notNull(),
    state: text("state").notNull(),
    body: text("body"),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.pullNumber, t.id] })],
);

export const reviewComments = sqliteTable(
  "review_comments",
  {
    repoId: text("repo_id").notNull(),
    pullNumber: integer("pull_number").notNull(),
    id: integer("id").notNull(),
    author: text("author").notNull(),
    createdAt: text("created_at").notNull(),
    path: text("path"),
    body: text("body").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.pullNumber, t.id] })],
);

export const defectEvents = sqliteTable(
  "defect_events",
  {
    repoId: text("repo_id").notNull(),
    pullNumber: integer("pull_number").notNull(),
    kind: text("kind").notNull(),
    at: text("at").notNull(),
    detail: text("detail"),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.pullNumber, t.kind, t.at] })],
);
