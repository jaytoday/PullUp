// Fixture-file PullSource: serves a FixtureFile JSON document through the
// PullSource seam. This is the offline default — the CLI analyzes fixtures
// without any GitHub access.

import { readFileSync } from "node:fs";
import type {
  FixtureFile,
  LintRuleFile,
  PullSource,
  SourceDefectEvent,
  SourcePull,
  SourceRepo,
  SourceReview,
  SourceReviewComment,
} from "@pullup/core";
import { parseRepoId } from "@pullup/core";

export class FixturePullSource implements PullSource {
  readonly repoId: string;

  constructor(
    private readonly fixture: FixtureFile,
    repoIdOverride?: string,
  ) {
    this.repoId =
      repoIdOverride ?? `${fixture.repo.owner}/${fixture.repo.repo}`;
    parseRepoId(this.repoId);
  }

  async readRepository(): Promise<SourceRepo> {
    return this.fixture.repo;
  }

  async listPulls(): Promise<SourcePull[]> {
    return this.fixture.pulls.map(({ reviews: _r, reviewComments: _c, defectEvents: _d, ...pull }) => pull);
  }

  async listReviews(pullNumber: number): Promise<SourceReview[]> {
    return [...(this.fixture.pulls.find((p) => p.number === pullNumber)?.reviews ?? [])];
  }

  async listReviewComments(pullNumber: number): Promise<SourceReviewComment[]> {
    return [...(this.fixture.pulls.find((p) => p.number === pullNumber)?.reviewComments ?? [])];
  }

  async listDefectEvents(pullNumber: number): Promise<SourceDefectEvent[]> {
    return [...(this.fixture.pulls.find((p) => p.number === pullNumber)?.defectEvents ?? [])];
  }

  async readLintRules(dir: string): Promise<{ commitSha: string | null; files: LintRuleFile[] } | null> {
    const files = this.fixture.lintRules?.[dir];
    return files ? { commitSha: null, files: [...files] } : null;
  }
}

/** Loads a fixture file from disk and wraps it as a PullSource. */
export function loadFixture(path: string, repoIdOverride?: string): FixturePullSource {
  const raw = readFileSync(path, "utf8");
  return new FixturePullSource(JSON.parse(raw) as FixtureFile, repoIdOverride);
}
