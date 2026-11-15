import { z } from "zod";

/**
 * What PullUp collects about one commit's CI before deciding anything: every
 * job of every workflow that ran, with each attempt (a rerun is a second
 * attempt), and the change itself. Collected from GitHub in production and
 * read from `fixtures/` in tests.
 */

export const conclusionSchema = z.enum(["success", "failure", "timed_out", "cancelled", "skipped"]);
export type Conclusion = z.infer<typeof conclusionSchema>;

export const attemptSchema = z.object({
  conclusion: conclusionSchema,
  /** Names of the tests that failed in this attempt, from the JUnit report when there is one. */
  failedTests: z.array(z.string()).default([]),
  /** The end of the job's log, for evidence. */
  logExcerpt: z.string().default(""),
});
export type Attempt = z.infer<typeof attemptSchema>;

/** A skipped job counts as passed; the hard-failure rule handles a workflow that skipped everything. */
export const attemptPassed = (a: Attempt) => a.conclusion === "success" || a.conclusion === "skipped";

export const jobSchema = z.object({
  workflow: z.string(),
  name: z.string(),
  /** Oldest first. More than one means the job was rerun. */
  attempts: z.array(attemptSchema).min(1),
});
export type Job = z.infer<typeof jobSchema>;

/** The pull request the commit belongs to, when there is one. */
export const pullInfoSchema = z.object({
  number: z.number().int(),
  title: z.string().default(""),
  body: z.string().default(""),
  labels: z.array(z.string()).default([]),
  /** GitHub login of the author. */
  author: z.string().default(""),
});
export type PullInfo = z.infer<typeof pullInfoSchema>;

export const ciRunSchema = z.object({
  repo: z.string(),
  headSha: z.string(),
  jobs: z.array(jobSchema),
  /** The pull request's unified diff against its base. */
  diff: z.string().default(""),
  pull: pullInfoSchema.nullable().default(null),
});
export type CiRun = z.input<typeof ciRunSchema>;
export type ParsedCiRun = z.infer<typeof ciRunSchema>;
