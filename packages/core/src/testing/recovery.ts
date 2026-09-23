// Recovery / two-cost eval: what would approving at each PR's w* have cost vs
// the current behavior? Both sides are expected costs under the TCM, so the
// difference is the model's own "cost of waiting" estimate.

import { hoursBetween } from "../schema/domain.js";
import type { PullRecord } from "../schema/domain.js";
import type { CostParams } from "../cost/params.js";
import {
  delayCost,
  expectedDefectCost,
  findOptimalWait,
} from "../cost/model.js";

export interface RecoveryRow {
  readonly pullNumber: number;
  readonly changeType: string;
  readonly actualWaitHours: number;
  readonly maxWaitHours: number;
  readonly actualWaitCost: number;
  readonly actualDefectCost: number;
  readonly actualTotal: number;
  readonly optimizedWaitCost: number;
  readonly optimizedDefectCost: number;
  readonly optimizedTotal: number;
}

export interface RecoveryResult {
  readonly rows: readonly RecoveryRow[];
  readonly currentTotal: number;
  readonly optimizedTotal: number;
  readonly savingsHours: number;
  readonly savingsPct: number;
}

export function recoveryAnalysis(
  pulls: readonly PullRecord[],
  params: CostParams,
  now: string,
): RecoveryResult {
  const rows: RecoveryRow[] = [];
  for (const p of pulls) {
    const wait = Math.max(0, hoursBetween(p.createdAt, p.mergedAt ?? p.closedAt ?? now));
    const wStar = findOptimalWait(params, p.changeType);
    const target = Math.min(wait, wStar);

    const actualWaitCost = delayCost(wait, params);
    const actualDefectCost = expectedDefectCost(wait, params, p.changeType);
    const optimizedWaitCost = delayCost(target, params);
    const optimizedDefectCost = expectedDefectCost(target, params, p.changeType);

    rows.push({
      pullNumber: p.number,
      changeType: p.changeType,
      actualWaitHours: Math.round(wait * 100) / 100,
      maxWaitHours: wStar,
      actualWaitCost: round2(actualWaitCost),
      actualDefectCost: round2(actualDefectCost),
      actualTotal: round2(actualWaitCost + actualDefectCost),
      optimizedWaitCost: round2(optimizedWaitCost),
      optimizedDefectCost: round2(optimizedDefectCost),
      optimizedTotal: round2(optimizedWaitCost + optimizedDefectCost),
    });
  }

  const currentTotal = rows.reduce((s, r) => s + r.actualTotal, 0);
  const optimizedTotal = rows.reduce((s, r) => s + r.optimizedTotal, 0);
  const savingsHours = currentTotal - optimizedTotal;
  const savingsPct = currentTotal > 0 ? savingsHours / currentTotal : 0;

  return { rows, currentTotal: round2(currentTotal), optimizedTotal: round2(optimizedTotal), savingsHours: round2(savingsHours), savingsPct };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
