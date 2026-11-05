import { z } from "zod";
import { extensionById } from "@pullup/extensions";
export { COUNCIL_MAY_PASS_DEFAULT, TRIGGER_IDS, type TriggerId } from "@pullup/extensions";
import { type ExtensionMode, NO_ANSWER_OPTIONS, type NoAnswerOption } from "@pullup/sdk";

/**
 * A repository's `.pullup/config.json`, always read from the default branch,
 * never from the pull request, so a pull request cannot loosen its own checks.
 * The host's own settings are here; each extension has its own section under
 * `extensions` (see `@pullup/extensions`), parsed with that extension's schema.
 * This module is also used in the browser (the setup page), so it uses no Node modules.
 */

/** The plan's default viewpoints. */
export const DEFAULT_SEATS = [
  "Test reliability: you care whether the tests can be trusted.",
  "Security: you care about sign-in, permissions, secrets and data exposure.",
  "Maintainer of the touched area: you know this code and what depends on it.",
  "Release safety: you care about what could break for users after this ships.",
];

export { NO_ANSWER_OPTIONS, type NoAnswerOption };
export const EXTENSION_MODES = ["off", "shadow", "active"] as const satisfies readonly ExtensionMode[];
const finalNoAnswer = z.enum(["fail", "follow-council", "pass"]);

const askSchema = z
  .object({
    /** The one person asked (placeholder until a smarter choice): a WithAI member id, an email or a phone number. */
    to: z.string().min(1),
    /** Asked when `onNoAnswer` is `escalate` and `to` did not answer in time. */
    backup: z.string().min(1).optional(),
    /** GitHub logins of `to` and `backup`, so their Pass / Fail buttons and `/pullup` comments count as theirs. */
    toGithub: z.string().min(1).optional(),
    backupGithub: z.string().min(1).optional(),
    deadlineMinutes: z.number().int().min(1).max(60 * 24 * 14).default(240),
    onNoAnswer: z.enum(NO_ANSWER_OPTIONS).default("fail"),
    /** After `escalate`, if the backup does not answer either. */
    onNoAnswerAfterBackup: finalNoAnswer.default("fail"),
    /** Override of `onNoAnswer` per question id (`core:flaky-test`) or per extension (`threat-model`). */
    perExtension: z.record(z.string(), z.enum(NO_ANSWER_OPTIONS)).default({}),
    /** Older name: per core trigger (`flaky-test`). Read into `perExtension` as `core:<trigger>`. */
    perTrigger: z.record(z.string(), z.enum(NO_ANSWER_OPTIONS)).optional(),
    /** One reminder at half the deadline. */
    remind: z.boolean().default(true),
  })
  .refine((a) => a.backup || (a.onNoAnswer !== "escalate" && ![...Object.values(a.perExtension), ...Object.values(a.perTrigger ?? {})].includes("escalate")), {
    message: "escalate needs ask.backup",
  });

const rawConfigSchema = z.object({
  /** Workflows that must finish before PullUp decides. A required workflow that never ran is a hard failure. */
  requiredWorkflows: z.array(z.string().min(1)).min(1),
  flaky: z
    .object({
      /** Tests known to fail now and then. A failure of only these tests is a question, not a hard failure. */
      knownTests: z.array(z.string()).default([]),
      /** Rerun a required workflow's failed jobs once, so a flaky failure can show itself (costs CI minutes; off by default). */
      rerun: z.boolean().default(false),
    })
    .default({ knownTests: [], rerun: false }),
  /** Older names of the core extension's settings; read into `extensions.core`. */
  triggers: z.record(z.string(), z.unknown()).optional(),
  sensitivePaths: z.record(z.string(), z.unknown()).optional(),
  council: z
    .object({
      /** One WithAI apply call per seat, each answering from its viewpoint. */
      seats: z.array(z.string().min(1).max(300)).min(1).max(6).default(DEFAULT_SEATS),
      /** Every seat must say "pass" at least this strongly (1–5) for the council to pass a question. */
      passStrength: z.number().int().min(1).max(5).default(4),
      /**
       * When true (default), one seat saying "needs a person" stops a council pass.
       * When false, a pass needs a strict majority of seats saying "pass" strongly
       * (a seat with a valid "fail" still fails the question first).
       */
      needsPersonBlocksPass: z.boolean().default(true),
      /** At most this many questions go to the council in one run (Active first, then Shadow); the rest go straight to a person. */
      maxQuestionsPerRun: z.number().int().min(1).max(20).default(6),
    })
    .default({ seats: DEFAULT_SEATS, passStrength: 4, needsPersonBlocksPass: true, maxQuestionsPerRun: 6 }),
  ask: askSchema,
  /** Cheap model checks extensions ask for (see the engine's screens.ts). */
  screens: z
    .object({
      /** At most this many screen calls per run; the rest are "not checked". */
      maxPerRun: z.number().int().min(0).max(200).default(20),
    })
    .default({ maxPerRun: 20 }),
  /** One section per bundled extension, keyed by its id. `core` runs unless switched off; the others only when listed. */
  extensions: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

/** The host's settings for one extension, and the extension's own section parsed with its schema. */
export interface ExtensionSettings {
  /** Off: skipped. Shadow: its questions are shown as "would ask" and never change the result. Active: they count. */
  mode: ExtensionMode;
  /** Shadow questions still go to the council, so its answers can be measured (costs WithAI calls). */
  shadowCouncil: boolean;
  /** At most this many questions from the extension per run; the rest are folded into one. */
  maxQuestions: number;
  config: Record<string, unknown>;
}

const hostSectionSchema = z.object({
  mode: z.enum(EXTENSION_MODES).optional(),
  shadowCouncil: z.boolean().default(true),
  maxQuestions: z.number().int().min(1).max(20).default(3),
});

export const configSchema = rawConfigSchema.transform((raw, ctx) => {
  const { triggers, sensitivePaths, extensions: listed, ask: rawAsk, ...rest } = raw;
  // Older configs: `triggers`, `sensitivePaths` and `ask.perTrigger` belong to the core extension now.
  const sections: Record<string, Record<string, unknown>> = { ...listed };
  if (triggers !== undefined || sensitivePaths !== undefined) {
    const core = { ...(sections.core ?? {}) };
    for (const [key, value] of Object.entries({ triggers, sensitivePaths })) {
      if (value === undefined) continue;
      if (key in core) ctx.addIssue({ code: "custom", message: `${key} is set twice: at the top level and in extensions.core`, path: [key] });
      core[key] = value;
    }
    sections.core = core;
  }
  const { perTrigger, ...ask } = rawAsk;
  for (const [trigger, option] of Object.entries(perTrigger ?? {})) ask.perExtension[`core:${trigger}`] ??= option;
  const extensions: Record<string, ExtensionSettings> = {};
  // Core first unless the repository placed it, then the listed ones in the order written.
  const ids = "core" in sections ? Object.keys(sections) : ["core", ...Object.keys(sections)];
  for (const id of ids) {
    const extension = extensionById(id);
    if (!extension) {
      ctx.addIssue({ code: "custom", message: `No bundled extension is called "${id}".`, path: ["extensions", id] });
      continue;
    }
    const { mode, shadowCouncil, maxQuestions, ...own } = sections[id] ?? {};
    const host = hostSectionSchema.safeParse({ mode, shadowCouncil, maxQuestions });
    const parsed = extension.config.schema.strict().safeParse(own);
    for (const issue of [...(host.error?.issues ?? []), ...(parsed.error?.issues ?? [])]) {
      ctx.addIssue({ code: "custom", message: issue.message, path: ["extensions", id, ...issue.path.map(String)] });
    }
    if (!host.success || !parsed.success) continue;
    extensions[id] = { mode: host.data.mode ?? extension.defaultMode ?? (id in sections ? "shadow" : "off"), shadowCouncil: host.data.shadowCouncil, maxQuestions: host.data.maxQuestions, config: parsed.data };
  }
  const cycle = needsCycle(Object.keys(extensions).filter((id) => extensions[id]!.mode !== "off"));
  if (cycle) ctx.addIssue({ code: "custom", message: `Extensions need each other in a circle: ${cycle.join(" → ")}.`, path: ["extensions"] });
  return { ...rest, ask, extensions };
});
export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;

/** A circle in the `needs` of the given extensions, or null. */
function needsCycle(ids: string[]): string[] | null {
  const on = new Set(ids);
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    path.push(id);
    for (const need of extensionById(id)?.needs ?? []) {
      if (!on.has(need)) continue;
      const found = visit(need);
      if (found) return found;
    }
    path.pop();
    state.set(id, "done");
    return null;
  };
  for (const id of ids) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}

/** The extensions that run (Shadow or Active), in run order: an extension after the ones it `needs`, otherwise in config order. */
export function enabledExtensions(config: Config): string[] {
  const on = Object.keys(config.extensions).filter((id) => config.extensions[id]!.mode !== "off");
  const out: string[] = [];
  const add = (id: string) => {
    if (out.includes(id)) return;
    for (const need of extensionById(id)?.needs ?? []) if (on.includes(need)) add(need);
    out.push(id);
  };
  on.forEach(add);
  return out;
}

/**
 * A parsed config back in the shape of `.pullup/config.json` (with every
 * default filled in): `parseConfig(configInput(c))` gives `c` again. The
 * settings page edits this and shows it as the file to commit.
 */
export function configInput(config: Config): ConfigInput & { extensions: Record<string, Record<string, unknown>> } {
  const { extensions, ...rest } = config;
  return {
    ...rest,
    extensions: Object.fromEntries(Object.entries(extensions).map(([id, s]) => [id, { mode: s.mode, shadowCouncil: s.shadowCouncil, maxQuestions: s.maxQuestions, ...s.config }])),
  };
}

export function extensionMode(config: Config, id: string): ExtensionMode {
  return config.extensions[id]?.mode ?? "off";
}

const getPath = (value: unknown, path: string): unknown => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), value);

export function parseConfig(raw: unknown): Config {
  return configSchema.parse(raw);
}

/**
 * The settings in a config that are looser than PullUp's defaults, in plain
 * words. The setup page asks for a typed confirmation when there are any.
 */
export function loosenings(config: Config): string[] {
  const out: string[] = [];
  for (const [id, settings] of Object.entries(config.extensions)) {
    const extension = extensionById(id)!;
    if (extension.defaultMode === "active" && settings.mode !== "active") out.push(`${extension.title} (${id}) is ${settings.mode === "off" ? "switched off" : "in Shadow mode"}.`);
    if (settings.mode === "off") continue;
    if (extension.loosenings) {
      out.push(...extension.loosenings(settings.config));
      continue;
    }
    const defaults = extension.config.schema.parse({});
    for (const field of extension.config.fields) {
      if (field.loosens && JSON.stringify(getPath(settings.config, field.key) ?? null) !== JSON.stringify(getPath(defaults, field.key) ?? null)) {
        out.push(`${extension.title}: "${field.label}" is changed from its default.`);
      }
    }
  }
  if (config.council.passStrength < 4) out.push(`The council passes with strength ${config.council.passStrength} (default 4).`);
  if (!config.council.needsPersonBlocksPass) out.push("One reviewer asking for a person no longer stops a council pass.");
  const passing = (o: NoAnswerOption) => o === "pass" || o === "follow-council";
  if (passing(config.ask.onNoAnswer)) out.push(`With no answer by the deadline, the run will ${config.ask.onNoAnswer === "pass" ? "pass" : "follow the council"}.`);
  if (config.ask.onNoAnswer === "escalate" && passing(config.ask.onNoAnswerAfterBackup)) out.push(`If the backup does not answer either, the run will ${config.ask.onNoAnswerAfterBackup === "pass" ? "pass" : "follow the council"}.`);
  for (const [key, option] of Object.entries(config.ask.perExtension)) if (passing(option)) out.push(`For ${key}, no answer means ${option === "pass" ? "pass" : "follow the council"}.`);
  return out;
}
