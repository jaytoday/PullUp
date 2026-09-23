// Defect proxies: how often do merged PRs come back to bite us, and how does
// that vary by change type / area? (Proxies: revert / hotfix / follow-up fix /
// reopened issue — ingested as DefectEvents.)

import type { PullRecord } from "../schema/domain.js";
import type { DefectRate, DefectReport } from "./types.js";

function defectRateOf(pulls: readonly PullRecord[]): DefectRate {
  const n = pulls.length;
  const defects = pulls.filter((p) => p.defectProxy !== null).length;
  return { n, defects, rate: n > 0 ? defects / n : null };
}

function groupDefectRates(
  pulls: readonly PullRecord[],
  key: (p: PullRecord) => string,
): Record<string, DefectRate> {
  const byKey = new Map<string, PullRecord[]>();
  for (const p of pulls) {
    const k = key(p);
    const list = byKey.get(k);
    if (list) list.push(p);
    else byKey.set(k, [p]);
  }
  return Object.fromEntries(
    [...byKey.entries()]
      .map(([k, v]) => [k, defectRateOf(v)] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}

export function defectReport(pulls: readonly PullRecord[]): DefectReport {
  const merged = pulls.filter((p) => p.state === "merged");
  return {
    overall: defectRateOf(merged),
    byChangeType: groupDefectRates(merged, (p) => p.changeType),
    byArea: groupDefectRates(merged, (p) => p.area),
  };
}
