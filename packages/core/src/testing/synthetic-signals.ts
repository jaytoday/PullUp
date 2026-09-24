// SyntheticSignalModel — a deterministic stand-in for Jev in tests, fixtures,
// and offline evals. A keyword oracle decides each question's "truth" from the
// hunk's changed lines, then answers with seeded noise and *deliberate*
// miscalibration (some questions overconfident, some underconfident), so the
// calibration step has something real to correct. It also reproduces the
// published injection effect: reviewer-addressed "pre-approved" text drags the
// sensitive probabilities down — which is why the tripwire and asymmetric
// authority exist.

import { sha256 } from "../signals/hunks.js";
import type {
  Answer,
  ChoiceAnswer,
  QuestionSet,
  ScoreAnswer,
  SignalModel,
  SignalUnit,
  UnitAnswers,
} from "../signals/types.js";
import { estimateTokens, statePayload } from "../signals/units.js";
import { mulberry32 } from "./generate.js";

const TEST_PATH = /(\.test\.|\.spec\.|__tests__\/|^tests?\/)/;
const DOC_PATH = /(\.mdx?$|^docs\/)/;
const MANIFEST_PATH = /(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|\.lock)$/;

const ORACLE: Readonly<Record<string, (changed: string, removed: string, path: string) => boolean>> = {
  touchesAuthn: (c) => /\b(jwt|session|password|login|authenticate|verifyToken|bcrypt|api[_-]?key)\b/i.test(c),
  touchesAuthz: (c) => /\b(roles?|permission|isAdmin|canAccess|authorize|acl|ForbiddenError|x-internal)\b/i.test(c),
  handlesSecrets: (c) => /(SECRET|PRIVATE_KEY|credential|process\.env\.[A-Z_]*(KEY|TOKEN|SECRET))/.test(c),
  addsNetworkCall: (c) => /(fetch\(|axios\.|http\.request|new WebSocket|got\()/.test(c),
  changesDependencyManifest: (_c, _r, path) => MANIFEST_PATH.test(path),
  weakensInputValidation: (_c, r) => /\b(validate|sanitize|escape|schema\.parse|z\.)/.test(r),
  removesErrorHandling: (_c, r) => /\b(catch|try|retry|throw)\b/.test(r),
  changesDbSchema: (c) => /(ALTER TABLE|CREATE TABLE|addColumn|sqliteTable)/i.test(c),
  changesConcurrency: (c) => /(mutex|\block\(|transaction|Promise\.all|acquire\(|atomic)/i.test(c),
  isTestOnly: (_c, _r, path) => TEST_PATH.test(path),
  isDocsOrCommentsOnly: (c, _r, path) =>
    DOC_PATH.test(path) || c.split("\n").every((l) => /^\s*(\/\/|#|\*|\/\*)/.test(l) || l.trim() === ""),
  isFormattingOnly: () => false, // computed below from the diff itself
  addressesReviewerOrAutomation: (c) =>
    /(auto-?approve|pre-?approved|security[- ]reviewed|safe to merge|skip (ci|review|checks)|reviewers and CI)/i.test(c),
};

/** Per-question logit scale: > 1 overconfident, < 1 underconfident. */
const MISCALIBRATION: Readonly<Record<string, number>> = {
  touchesAuthn: 1.4,
  handlesSecrets: 1.4,
  addsNetworkCall: 0.8,
  removesErrorHandling: 0.8,
  changesConcurrency: 0.8,
};

function changedLines(hunk: string): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of hunk.split("\n")) {
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { added, removed };
}

function isFormatting(added: readonly string[], removed: readonly string[]): boolean {
  if (added.length === 0 || added.length !== removed.length) return false;
  const norm = (l: string) => l.replace(/\s+/g, "");
  return added.every((l, i) => norm(l) === norm(removed[i]!));
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function seeded(key: string): () => number {
  return mulberry32(Number.parseInt(sha256(key).slice(0, 8), 16));
}

export interface SyntheticModelOptions {
  readonly id?: string;
  readonly noise?: number;
}

export class SyntheticSignalModel implements SignalModel {
  readonly id: string;
  private readonly noise: number;

  constructor(opts: SyntheticModelOptions = {}) {
    this.id = opts.id ?? "synthetic-v1";
    this.noise = opts.noise ?? 0.5;
  }

  async evaluate(units: readonly SignalUnit[], qs: QuestionSet): Promise<Array<UnitAnswers | null>> {
    return units.map((u) => this.answer(u, qs));
  }

  private answer(u: SignalUnit, qs: QuestionSet): UnitAnswers {
    const { added, removed } = changedLines(u.state.hunk);
    const changed = [...added, ...removed].join("\n");
    const removedText = removed.join("\n");
    const truth: Record<string, boolean> = {};
    for (const [q, fn] of Object.entries(ORACLE)) truth[q] = fn(changed, removedText, u.path);
    truth.isFormattingOnly = isFormatting(added, removed);
    const injected = truth[qs.injection] === true;

    const answers: Record<string, Answer> = {};
    for (const [q, spec] of Object.entries(qs.questions)) {
      const rand = seeded(`${this.id}|${u.stateHash}|${q}`);
      if (spec.kind === "noul") {
        const scale = MISCALIBRATION[q] ?? 1;
        let z = (truth[q] ? 3 : -4) * scale + this.noise * gaussian(rand);
        // Injection effect: "pre-approved" text pulls sensitive answers down.
        if (injected && qs.sensitive.includes(q)) z -= 2.5;
        answers[q] = { kind: "noul", p: round(1 / (1 + Math.exp(-z))) };
      } else if (spec.kind === "choice") {
        answers[q] = this.changeKind(spec.options, truth, u.path, rand);
      } else {
        answers[q] = this.blast(spec.levels.length, truth, qs, rand);
      }
    }
    return {
      answers,
      modelId: this.id,
      inputTokens: estimateTokens(statePayload(u.state)) + 600,
      latencyMs: 0,
    };
  }

  private changeKind(
    options: Readonly<Record<string, string>>,
    truth: Record<string, boolean>,
    path: string,
    rand: () => number,
  ): ChoiceAnswer {
    const kind = truth.isDocsOrCommentsOnly
      ? "docs"
      : truth.isTestOnly
        ? "test"
        : truth.isFormattingOnly
          ? "formatting"
          : truth.changesDependencyManifest
            ? "dependency"
            : /fix|bug/i.test(path)
              ? "bugfix"
              : "feature";
    const labels = Object.keys(options);
    const top = Math.min(0.97, 0.86 + 0.08 * rand());
    const rest = (1 - top) / Math.max(1, labels.length - 1);
    const probabilities = Object.fromEntries(labels.map((l) => [l, round(l === kind ? top : rest)]));
    return { kind: "choice", choice: kind, confidence: round(top), probabilities };
  }

  private blast(levels: number, truth: Record<string, boolean>, qs: QuestionSet, rand: () => number): ScoreAnswer {
    const hits = qs.sensitive.filter((q) => truth[q]).length;
    const low = qs.lowRisk.some((q) => truth[q]);
    const level = low ? 0 : Math.min(levels - 1, 1 + hits);
    const probabilities: Record<string, number> = {};
    for (let i = 0; i < levels; i++) probabilities[String(i)] = i === level ? 0.8 : 0.2 / (levels - 1);
    const score = level + (rand() - 0.5) * 0.2;
    return { kind: "score", score: round(Math.max(0, Math.min(levels - 1, score))), confidence: 0.8, probabilities };
  }
}

function round(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
