// Review-latency statistics: how long do reviews take here, and how does it
// vary by area / contributor / size?

import { hoursBetween } from "../schema/domain.js";
import type { PullRecord } from "../schema/domain.js";
import type { LatencyReport } from "./types.js";
import { latencyStats } from "./stats.js";

function timeToFirstReview(p: PullRecord): number | null {
  if (!p.firstHumanReviewAt) return null;
  return hoursBetween(p.createdAt, p.firstHumanReviewAt);
}

function totalReviewTime(p: PullRecord): number | null {
  if (p.firstHumanReviewAt == null || p.reviewCompletedAt == null) return null;
  return hoursBetween(p.firstHumanReviewAt, p.reviewCompletedAt);
}

function waitTime(p: PullRecord): number | null {
  if (p.mergedAt) return hoursBetween(p.createdAt, p.mergedAt);
  if (p.closedAt) return hoursBetween(p.createdAt, p.closedAt);
  return null;
}

export function latencyReport(pulls: readonly PullRecord[]): LatencyReport {
  const ttf = pulls
    .map(timeToFirstReview)
    .filter((x): x is number => x !== null);
  const total = pulls
    .map(totalReviewTime)
    .filter((x): x is number => x !== null);
  const wait = pulls
    .map(waitTime)
    .filter((x): x is number => x !== null);

  const byArea: Record<string, number[]> = {};
  const byContributor: Record<string, number[]> = {};
  const bySize: Record<string, number[]> = {};
  for (const p of pulls) {
    const t = timeToFirstReview(p);
    if (t === null) continue;
    (byArea[p.area] ??= []).push(t);
    (byContributor[p.author] ??= []).push(t);
    (bySize[p.sizeBucket] ??= []).push(t);
  }
  const statsOf = (groups: Record<string, number[]>) =>
    Object.fromEntries(
      Object.entries(groups)
        .map(([k, v]) => [k, latencyStats(v)] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
    );

  return {
    timeToFirstReviewHours: latencyStats(ttf),
    totalReviewHours: latencyStats(total),
    waitHours: latencyStats(wait),
    byArea: statsOf(byArea),
    byContributor: statsOf(byContributor),
    bySize: statsOf(bySize),
  };
}
