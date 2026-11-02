// Picks the SignalModel for a run: live Jev when a key is present, otherwise
// the deterministic synthetic model (offline default), or an explicit replay.
// `systemone` sends units to any System One server (Ollama, llama.cpp,
// OpenCode Zen) named by the operator's environment: never by repo settings,
// because the setting decides where the repo's code is sent.

import { readFileSync } from "node:fs";
import { ReplaySignalModel } from "@pullup/core";
import type { JevConfig, ReplayFile, SignalModel } from "@pullup/core";
import { SyntheticSignalModel } from "@pullup/core/testing";
import { JevSignalModel } from "./jev.js";

export type SignalModelKind = "jev" | "systemone" | "synthetic" | "replay";

export interface ResolveModelOptions {
  readonly kind?: SignalModelKind;
  readonly replayPath?: string;
  readonly config: JevConfig;
  readonly env?: NodeJS.ProcessEnv;
}

export interface ResolvedModel {
  readonly model: SignalModel;
  readonly kind: SignalModelKind;
  readonly note: string | null;
}

export function resolveSignalModel(opts: ResolveModelOptions): ResolvedModel {
  const env = opts.env ?? process.env;
  const requested = opts.kind ?? (env.PULLUP_SIGNAL_MODEL as SignalModelKind | undefined);
  const kind: SignalModelKind = requested ?? (env.TYPESAFE_API_KEY ? "jev" : env.PULLUP_SYSTEMONE_URL ? "systemone" : "synthetic");

  if (kind === "jev") {
    if (!env.TYPESAFE_API_KEY) {
      throw new Error("Live Jev needs TYPESAFE_API_KEY (or use --model synthetic / replay).");
    }
    return {
      kind,
      note: null,
      model: new JevSignalModel({
        apiKey: env.TYPESAFE_API_KEY,
        model: opts.config.model,
        concurrency: opts.config.concurrency,
        requestsPerMinute: opts.config.requestsPerMinute,
      }),
    };
  }
  if (kind === "systemone") {
    const baseUrl = env.PULLUP_SYSTEMONE_URL;
    if (!baseUrl) throw new Error("--model systemone needs PULLUP_SYSTEMONE_URL (a System One server, such as http://localhost:11434).");
    let host: string;
    try {
      host = new URL(baseUrl).host;
    } catch {
      throw new Error(`PULLUP_SYSTEMONE_URL is not a URL: ${baseUrl}`);
    }
    const model = env.PULLUP_SYSTEMONE_MODEL ?? opts.config.model;
    return {
      kind,
      note: `System One server ${host}, model ${model}: diff hunks are sent to that server. Calibrate separately; answers are cached under ${model}@${host}.`,
      model: new JevSignalModel({
        baseUrl,
        model,
        stateFormat: env.PULLUP_SYSTEMONE_STATE === "object" ? "object" : "text",
        ...(env.PULLUP_SYSTEMONE_API_KEY ? { apiKey: env.PULLUP_SYSTEMONE_API_KEY } : {}),
        concurrency: opts.config.concurrency,
        requestsPerMinute: opts.config.requestsPerMinute,
      }),
    };
  }
  if (kind === "replay") {
    const path = opts.replayPath ?? env.PULLUP_REPLAY_PATH;
    if (!path) throw new Error("Replay model needs a replay file (--replay <path> or PULLUP_REPLAY_PATH).");
    const file = JSON.parse(readFileSync(path, "utf8")) as ReplayFile;
    return { kind, note: `Replaying recorded answers from ${path}.`, model: new ReplaySignalModel(file) };
  }
  return {
    kind: "synthetic",
    note: requested
      ? "Synthetic signal model (deterministic stand-in, not Jev)."
      : "No TYPESAFE_API_KEY: using the deterministic synthetic signal model, not Jev.",
    model: new SyntheticSignalModel(),
  };
}
