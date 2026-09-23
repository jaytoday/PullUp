// Congestion: review is a queue with finite reviewer capacity. For each day in
// the observed window we compute the number of open PRs still awaiting their
// first human review, the pool of active reviewers (7-day window), the queue
// depth (awaiting ÷ capacity), and mean first-review response time that day.

import { addHours, hoursBetween } from "../schema/domain.js";
import type { PullRecord, ReviewRecord } from "../schema/domain.js";
import type { CongestionPoint, CongestionReport } from "./types.js";
import { mean } from "./stats.js";

function dayStartIso(iso: string): string {
  return `${iso.slice(0, 10)}T00:00:00.000Z`;
}

export function congestionReport(
  pulls: readonly PullRecord[],
  reviews: readonly ReviewRecord[],
): CongestionReport {
  let start: string | null = null;
  let end: string | null = null;
  for (const p of pulls) {
    const c = dayStartIso(p.createdAt);
    if (!start || c < start) start = c;
    const finish = p.mergedAt ?? p.closedAt;
    if (finish) {
      const f = dayStartIso(finish);
      if (!end || f > end) end = f;
    }
  }
  if (!start) return { points: [], current: null, meanQueueDepth: null };
  const nowDay = dayStartIso(new Date().toISOString());
  // Cap the window at today — the generator can create finish times past "now".
  const lastDay = end && end < nowDay ? end : nowDay;

  const points: CongestionPoint[] = [];
  for (let d = start; d <= lastDay; d = addHours(d, 24)) {
    const dayEnd = addHours(d, 24); // exclusive
    const open = pulls.filter(
      (p) =>
        p.createdAt < dayEnd &&
        (p.mergedAt == null || p.mergedAt >= dayEnd) &&
        (p.closedAt == null || p.closedAt >= dayEnd),
    );
    const awaitingReview = open.filter(
      (p) => p.firstHumanReviewAt == null || p.firstHumanReviewAt >= dayEnd,
    );
    const weekStart = addHours(d, -7 * 24);
    const activeReviewers = new Set(
      reviews
        .filter((r) => r.submittedAt >= weekStart && r.submittedAt < dayEnd)
        .map((r) => r.author),
    ).size;
    const queueDepth = awaitingReview.length / Math.max(1, activeReviewers);
    const reviewedOnDay = pulls.filter(
      (p) => p.firstHumanReviewAt != null && p.firstHumanReviewAt >= d && p.firstHumanReviewAt < dayEnd,
    );
    const responseHours = reviewedOnDay
      .map((p) => hoursBetween(p.createdAt, p.firstHumanReviewAt!))
      .filter((h) => Number.isFinite(h));

    points.push({
      day: d.slice(0, 10),
      openPullsAwaitingReview: awaitingReview.length,
      activeReviewers,
      queueDepth,
      meanResponseHours: mean(responseHours),
    });
  }

  const current = points[points.length - 1] ?? null;
  const depths = points.map((p) => p.queueDepth);
  return { points, current, meanQueueDepth: mean(depths) };
}
