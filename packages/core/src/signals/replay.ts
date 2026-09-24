// Record/replay for signal models. A replay file pins exact answers for exact
// unit states, so offline evals and CI reproduce a live Jev run byte-for-byte
// without network or key. A replay miss fails loudly — never a silent default.

import type { QuestionSet, SignalModel, SignalUnit, UnitAnswers } from "./types.js";

export interface ReplayFile {
  readonly kind: "pullup-jev-replay";
  readonly modelId: string;
  readonly questionSetVersion: string;
  /** Keyed by SignalUnit.stateHash. */
  readonly entries: Readonly<Record<string, UnitAnswers>>;
}

export class ReplaySignalModel implements SignalModel {
  readonly id: string;

  constructor(private readonly file: ReplayFile) {
    this.id = file.modelId;
  }

  async evaluate(units: readonly SignalUnit[], qs: QuestionSet): Promise<Array<UnitAnswers | null>> {
    if (qs.version !== this.file.questionSetVersion) {
      throw new Error(
        `Replay recorded with question set ${this.file.questionSetVersion}, asked ${qs.version}.`,
      );
    }
    return units.map((u) => {
      const hit = this.file.entries[u.stateHash];
      if (!hit) throw new Error(`Replay miss for unit ${u.key} (state ${u.stateHash.slice(0, 12)}).`);
      return hit;
    });
  }
}

/** Wraps any model and records every answer it returns. */
export class RecordingSignalModel implements SignalModel {
  readonly id: string;
  private readonly entries = new Map<string, UnitAnswers>();
  private qsVersion: string | null = null;

  constructor(private readonly inner: SignalModel) {
    this.id = inner.id;
  }

  async evaluate(units: readonly SignalUnit[], qs: QuestionSet): Promise<Array<UnitAnswers | null>> {
    this.qsVersion = qs.version;
    const out = await this.inner.evaluate(units, qs);
    out.forEach((a, i) => {
      if (a) this.entries.set(units[i]!.stateHash, a);
    });
    return out;
  }

  toReplayFile(): ReplayFile {
    const sorted = [...this.entries.entries()].sort(([a], [b]) => a.localeCompare(b));
    return {
      kind: "pullup-jev-replay",
      modelId: this.id,
      questionSetVersion: this.qsVersion ?? "",
      entries: Object.fromEntries(sorted),
    };
  }
}
