// Review efficacy: what fraction of ship-risk does review remove? Estimated as
// the difference in shipped-defect rate between merged PRs whose review surfaced
// substantive findings and those whose did not — shrunk toward the defect prior.

import type { PullRecord } from "../schema/domain.js";
import type { CostPriors } from "../config/config.js";
import type { DefectRate, EfficacyReport } from "./types.js";
import { clamp, shrunkRate } from "./stats.js";

function countDefects(pulls: readonly PullRecord[]): DefectRate {
  const defects = pulls.filter((p) => p.defectProxy !== null).length;
  return { n: pulls.length, defects, rate: pulls.length > 0 ? defects / pulls.length : null };
}

export function efficacyReport(
  pulls: readonly PullRecord[],
  priors: CostPriors,
): EfficacyReport {
  // Population: merged PRs that actually got at least one review.
  const reviewedMerged = pulls.filter(
    (p) => p.state === "merged" && p.reviewCount > 0,
  );
  const withFindings = reviewedMerged.filter((p) => p.hadFindings);
  const withoutFindings = reviewedMerged.filter((p) => !p.hadFindings);

  const wf = countDefects(withFindings);
  const wof = countDefects(withoutFindings);

  // Shrink both rates toward the defect prior so tiny samples don't produce
  // extreme efficacy estimates.
  const wfRate = shrunkRate(wf.defects, wf.n, priors.defectPrior, priors.efficacyPriorWeight);
  const wofRate = shrunkRate(wof.defects, wof.n, priors.defectPrior, priors.efficacyPriorWeight);

  let eMax: number;
  if (wofRate <= 0) {
    // No baseline defect rate to compare against — fall back to the prior.
    eMax = priors.efficacyPrior;
  } else {
    const measured = clamp(1 - wfRate / wofRate, 0, 1);
    // A non-positive measured value means "no signal" after shrinkage — fall
    // back to the prior rather than claiming review is useless.
    eMax = measured > 0 ? measured : priors.efficacyPrior;
  }

  return { withFindings: wf, withoutFindings: wof, eMax };
}
