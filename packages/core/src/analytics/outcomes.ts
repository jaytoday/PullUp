// How do review outcomes correlate with how long the PR waited? Buckets by
// wait-hours (time open) and Pearson correlation per PR — the empirical
// backbone of "does longer wait change the outcome."

import { hoursBetween } from "../schema/domain.js";
import type { PullRecord } from "../schema/domain.js";
import type { OutcomeBucket, OutcomesReport } from "./types.js";
import { pearson } from "./stats.js";

export const WAIT_BUCKET_HOURS: readonly number[] = [0, 6, 12, 24, 48, 96, 168];

function waitHours(p: PullRecord): number | null {
  const end = p.mergedAt ?? p.closedAt;
  if (!end) return null;
  return hoursBetween(p.createdAt, end);
}

function bucketIndexOf(hours: number): number {
  for (let i = 0; i < WAIT_BUCKET_HOURS.length; i++) {
    if (hours < WAIT_BUCKET_HOURS[i]!) {
      return i;
    }
  }
  // Past the last boundary (≥168h) — fold into the final bucket.
  return WAIT_BUCKET_HOURS.length - 1;
}

export function outcomesReport(pulls: readonly PullRecord[]): OutcomesReport {
  const n = WAIT_BUCKET_HOURS.length;
  const counts = Array.from({ length: n }, () => ({
    n: 0,
    approvals: 0,
    changesRequested: 0,
    commented: 0,
    merged: 0,
    shipped: 0,
  }));

  const approvalPairs: Array<[number, number]> = [];
  const changesPairs: Array<[number, number]> = [];

  for (const p of pulls) {
    const w = waitHours(p);
    if (w === null) continue;
    const idx = bucketIndexOf(w);
    const bucket = counts[idx]!;
    bucket.n += 1;
    if (p.reviewOutcome === "approved") {
      bucket.approvals += 1;
      approvalPairs.push([w, 1]);
    } else if (p.reviewOutcome === "changes_requested") {
      bucket.changesRequested += 1;
      changesPairs.push([w, 1]);
    } else if (p.reviewOutcome === "commented") {
      bucket.commented += 1;
    }
    if (p.reviewOutcome === "approved") changesPairs.push([w, 0]);
    if (p.reviewOutcome !== "approved" && p.reviewOutcome !== "none") {
      approvalPairs.push([w, 0]);
    }
    if (p.state === "merged") {
      bucket.merged += 1;
      if (p.defectProxy) bucket.shipped += 1;
    }
  }

  const buckets: OutcomeBucket[] = counts.map((c, i) => {
    const bucketHours = i < WAIT_BUCKET_HOURS.length ? WAIT_BUCKET_HOURS[i]! : 168;
    return {
      bucketHours,
      n: c.n,
      approvals: c.approvals,
      changesRequested: c.changesRequested,
      commented: c.commented,
      approvalRate: c.n > 0 ? c.approvals / c.n : null,
      changesRequestedRate: c.n > 0 ? c.changesRequested / c.n : null,
      shippedDefectRate: c.merged > 0 ? c.shipped / c.merged : null,
    };
  });

  const approvalVsWaitCorrelation =
    approvalPairs.length >= 2
      ? pearson(
          approvalPairs.map(([w]) => w),
          approvalPairs.map(([, o]) => o),
        )
      : null;
  const changesRequestedVsWaitCorrelation =
    changesPairs.length >= 2
      ? pearson(
          changesPairs.map(([w]) => w),
          changesPairs.map(([, o]) => o),
        )
      : null;

  return { buckets, approvalVsWaitCorrelation, changesRequestedVsWaitCorrelation };
}
