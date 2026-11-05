import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BUNDLED, replaceExtensionsForTest } from "@pullup/extensions";
import { ciRunSchema, defineExtension, type Extension } from "@pullup/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { enabledExtensions, loosenings, parseConfig } from "./config";
import { compositionHash, describeExtensions, neverRelaxed, runExtensions } from "./host";
import { decideRun } from "./resolution";
import { fixedCouncil, seeded } from "./testing";

const core = BUNDLED.find((e) => e.id === "core")!;
let restore: (() => void) | null = null;
const use = (...list: Extension[]) => {
  restore = replaceExtensionsForTest([core, ...list]);
};
afterEach(() => {
  restore?.();
  restore = null;
});

const run = (diff = "") => ciRunSchema.parse({ repo: "a/b", headSha: "h", jobs: [{ workflow: "ci", name: "t", attempts: [{ conclusion: "success" }] }], diff });
const SENSITIVE = "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1 +1 @@\n-const MAX_AGE = 1;\n+const MAX_AGE = 30;\n";
const base = { requiredWorkflows: ["ci"], ask: { to: "sam@example.com" } };

/** Raises `count` questions; the council may pass them unless `personOnly`. */
const asker = defineExtension({
  id: "asker",
  version: "1.0.0",
  title: "Asker",
  summary: "Test extension.",
  config: { schema: z.object({ count: z.number().default(1), personOnly: z.boolean().default(false) }), fields: [] },
  detect: ({ config }) => ({
    questions: Array.from({ length: config.count }, (_, i) => ({ key: `q${i}`, prompt: `Question ${i}?`, summary: `Summary ${i}.`, evidence: [], councilMayPass: !config.personOnly })),
  }),
});

describe("config", () => {
  it("core runs unless switched off; others only when listed, in Shadow when no mode is given", () => {
    use(asker);
    expect(enabledExtensions(parseConfig(base))).toEqual(["core"]);
    expect(parseConfig({ ...base, extensions: { asker: {} } }).extensions.asker!.mode).toBe("shadow");
    expect(enabledExtensions(parseConfig({ ...base, extensions: { core: { mode: "off" }, asker: { mode: "active" } } }))).toEqual(["asker"]);
  });

  it("an unknown extension, an unknown setting and a bad mode are config errors", () => {
    use(asker);
    expect(() => parseConfig({ ...base, extensions: { nope: {} } })).toThrow(/No bundled extension is called/);
    expect(() => parseConfig({ ...base, extensions: { asker: { typo: 1 } } })).toThrow(/typo/);
    expect(() => parseConfig({ ...base, extensions: { asker: { mode: "loud" } } })).toThrow();
  });

  it("the old top-level keys and the new extensions.core section give the same config; setting both is an error", () => {
    const old = parseConfig({ ...base, triggers: { "flaky-test": { enabled: false } }, sensitivePaths: { off: ["payments"] }, ask: { to: "x", perTrigger: { "weakened-tests": "pass" } } });
    const now = parseConfig({ ...base, extensions: { core: { triggers: { "flaky-test": { enabled: false } }, sensitivePaths: { off: ["payments"] } } }, ask: { to: "x", perExtension: { "core:weakened-tests": "pass" } } });
    expect(old).toEqual(now);
    expect(() => parseConfig({ ...base, triggers: {}, extensions: { core: { triggers: {} } } })).toThrow(/set twice/);
  });

  it("extensions that need each other in a circle are a config error", () => {
    const a = defineExtension({ ...asker, id: "a", needs: ["b"] });
    const b = defineExtension({ ...asker, id: "b", needs: ["a"] });
    use(a, b);
    expect(() => parseConfig({ ...base, extensions: { a: {}, b: {} } })).toThrow(/circle/);
    expect(() => parseConfig({ ...base, extensions: { a: {}, b: { mode: "off" } } })).not.toThrow();
  });

  it("switching core off or to Shadow, and changing a loosens field, are loosenings", () => {
    const lenient = defineExtension({ id: "lenient", version: "1.0.0", title: "Lenient", summary: "Test extension.", config: { schema: z.object({ allow: z.boolean().default(false) }), fields: [{ key: "allow", label: "Allow", help: "", kind: "boolean", loosens: true }] } });
    use(lenient);
    expect(loosenings(parseConfig({ ...base, extensions: { core: { mode: "shadow" } } }))).toEqual(["Core checks (core) is in Shadow mode."]);
    expect(loosenings(parseConfig({ ...base, extensions: { lenient: { allow: true } } }))).toEqual(['Lenient: "Allow" is changed from its default.']);
    expect(loosenings(parseConfig({ ...base, extensions: { lenient: { allow: true, mode: "off" } } }))).toEqual([]);
  });
});

describe("the host", () => {
  it("every fixture's config gives the same decision in the old and the new shape", async () => {
    const dir = fileURLToPath(new URL("../../../fixtures", import.meta.url));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const raw = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
      const { triggers, sensitivePaths, ...rest } = raw.config;
      const moved = { ...rest, extensions: { core: { ...(triggers ? { triggers } : {}), ...(sensitivePaths ? { sensitivePaths } : {}) }, ...rest.extensions } };
      const council = () => fixedCouncil({ verdict: "pass", strength: 5, reason: "ok", quotes: [] });
      const r = ciRunSchema.parse(raw.run);
      expect(await decideRun(r, parseConfig(moved), council(), { now: 0 }), file).toEqual(await decideRun(r, parseConfig(raw.config), council(), { now: 0 }));
    }
  });

  it("ignores anything a hostile extension returns outside its own questions, facts, notes and annotations", () => {
    const hostile = defineExtension({
      ...asker,
      id: "hostile",
      detect: (ctx) => {
        // Tries to change what other extensions see, to return a result, and to drop or soften core's question.
        (ctx.diff as unknown[]).length = 0;
        return { questions: [], result: "pass", drop: ["core:sensitive-path"], councilMayPass: { "core:sensitive-path": true } } as never;
      },
    });
    use(hostile);
    const config = parseConfig({ ...base, extensions: { hostile: { mode: "active" } } });
    const { questions, outputs } = runExtensions(run(SENSITIVE), config, { now: 0 });
    // Its attempt to empty the shared diff threw (the host freezes what it shares), so it raised a person-only question.
    expect(questions.map((q) => [q.id, q.councilMayPass])).toEqual([
      ["core:sensitive-path", false],
      ["hostile:extension-error", false],
    ]);
    expect(outputs.find((o) => o.id === "hostile")!.error).toMatch(/read.only|not extensible|Cannot/i);
  });

  it("an extension that throws or returns a bad shape raises a question only a person may pass", () => {
    const thrower = defineExtension({ ...asker, id: "thrower", detect: () => { throw new Error("boom"); } });
    const bad = defineExtension({ ...asker, id: "bad", detect: () => ({ questions: [{ key: "has spaces", prompt: "", summary: "", evidence: [], councilMayPass: true }] }) });
    use(thrower, bad);
    const { questions } = runExtensions(run(), parseConfig({ ...base, extensions: { thrower: { mode: "active" }, bad: { mode: "active" } } }), { now: 0 });
    expect(questions.map((q) => [q.id, q.councilMayPass, q.neverRelax])).toEqual([
      ["thrower:extension-error", false, true],
      ["bad:extension-error", false, true],
    ]);
  });

  it("Shadow questions are shown and sent to the council but never change the result", async () => {
    use(asker);
    const council = fixedCouncil({ verdict: "needs-person", strength: 3, reason: "unsure", quotes: [] });
    const decision = await decideRun(run(), parseConfig({ ...base, extensions: { asker: { mode: "shadow", count: 2 } } }), council, { now: 0 });
    expect(decision.result).toBe("pass");
    expect(decision.reason).toMatch(/2 Shadow question/);
    expect(decision.questions.map((q) => [q.question.id, q.question.shadow, q.outcome])).toEqual([
      ["asker:q0", true, "ask"],
      ["asker:q1", true, "ask"],
    ]);
    expect(council.calls).toBe(8);
    const quiet = fixedCouncil({ verdict: "pass", strength: 5, reason: "", quotes: [] });
    await decideRun(run(), parseConfig({ ...base, extensions: { asker: { mode: "shadow", count: 2, shadowCouncil: false } } }), quiet, { now: 0 });
    expect(quiet.calls).toBe(0);
  });

  it("every combination of modes: only Active extensions change the result", async () => {
    use(asker);
    for (const coreMode of ["off", "shadow", "active"] as const) {
      for (const askerMode of ["off", "shadow", "active"] as const) {
        const config = parseConfig({ ...base, extensions: { core: { mode: coreMode }, asker: { mode: askerMode, personOnly: true } } });
        const decision = await decideRun(run(SENSITIVE), config, fixedCouncil({ verdict: "pass", strength: 5, reason: "", quotes: [] }), { now: 0 });
        const expected = coreMode === "active" || askerMode === "active" ? "waiting" : "pass";
        expect(decision.result, `${coreMode}/${askerMode}`).toBe(expected);
        expect(decision.questions.every((q) => q.question.shadow === (config.extensions[q.question.extension]!.mode === "shadow"))).toBe(true);
      }
    }
  });

  it("folds questions over an extension's cap into one, and sends questions over the run's council cap straight to a person", async () => {
    use(asker);
    const folded = runExtensions(run(), parseConfig({ ...base, extensions: { asker: { mode: "active", count: 5, maxQuestions: 3 } } }), { now: 0 }).questions;
    expect(folded.map((q) => q.id)).toEqual(["asker:q0", "asker:q1", "asker:more"]);
    expect(folded[2]!.summary).toBe("Summary 2. Summary 3. Summary 4.");
    const council = fixedCouncil({ verdict: "pass", strength: 5, reason: "", quotes: [] });
    const config = parseConfig({ ...base, council: { maxQuestionsPerRun: 2 }, extensions: { asker: { mode: "active", count: 4, maxQuestions: 4 } } });
    const decision = await decideRun(run(), config, council, { now: 0 });
    expect(council.calls).toBe(2 * 4);
    expect(decision.questions.filter((q) => q.question.skipCouncil).map((q) => q.reason)).toEqual([
      "Asking a person straight away: more questions than the council takes in one run.",
      "Asking a person straight away: more questions than the council takes in one run.",
    ]);
    expect(decision.result).toBe("waiting");
  });

  it("facts flow only to extensions that need the publisher, which run after it", () => {
    const publisher = defineExtension({ ...asker, id: "publisher", detect: () => ({ facts: [{ kind: "inert", flag: "newCheckout", status: "verified" }] }) });
    const seen: unknown[] = [];
    const reader = defineExtension({ ...asker, id: "reader", needs: ["publisher"], detect: (ctx) => (seen.push(ctx.facts.get("inert")), {}) });
    const stranger = defineExtension({ ...asker, id: "stranger", detect: (ctx) => (seen.push(ctx.facts.get("inert")), {}) });
    use(reader, publisher, stranger);
    // Listed reader first: it still runs after the publisher it needs.
    const config = parseConfig({ ...base, extensions: { reader: {}, publisher: {}, stranger: {} } });
    expect(enabledExtensions(config)).toEqual(["core", "publisher", "reader", "stranger"]);
    runExtensions(run(), config, { now: 0 });
    expect(seen).toEqual([[{ kind: "inert", flag: "newCheckout", status: "verified", extension: "publisher" }], []]);
  });

  it("notes never change a result", async () => {
    const noter = defineExtension({ ...asker, id: "noter", detect: undefined, notes: () => [{ text: "See docs/designs/auth.md" }] });
    use(noter);
    for (const diff of ["", SENSITIVE]) {
      const council = () => fixedCouncil({ verdict: "needs-person", strength: 3, reason: "", quotes: [] });
      const without = await decideRun(run(diff), parseConfig(base), council(), { now: 0 });
      const withNotes = await decideRun(run(diff), parseConfig({ ...base, extensions: { noter: { mode: "active" } } }), council(), { now: 0 });
      expect(withNotes.extensions!.notes).toEqual([{ text: "See docs/designs/auth.md", extension: "noter" }]);
      expect([withNotes.result, withNotes.reason, withNotes.questions]).toEqual([without.result, without.reason, without.questions]);
    }
  });

  it("asks the people the first extension names, else ask.to", () => {
    const owners = defineExtension({ ...asker, id: "owners", detect: undefined, recipients: (_ctx, q) => (q.id === "core:sensitive-path" ? ["owner@example.com"] : null) });
    use(owners);
    const { questions } = runExtensions(run(SENSITIVE), parseConfig({ ...base, extensions: { owners: { mode: "active" } } }), { now: 0 });
    expect(questions[0]!.askTo).toEqual(["owner@example.com"]);
  });

  it("records each extension's version and output, and a composition hash that changes with any setting", () => {
    use(asker);
    const a = parseConfig({ ...base, extensions: { asker: { count: 1 } } });
    const b = parseConfig({ ...base, extensions: { asker: { count: 2 } } });
    expect(compositionHash(a)).not.toBe(compositionHash(b));
    expect(compositionHash(a)).toBe(compositionHash(parseConfig({ ...base, extensions: { asker: { count: 1 } } })));
    const { outputs } = runExtensions(run(), a, { now: 0 });
    expect(outputs.map((o) => [o.id, o.version, o.mode, o.questions])).toEqual([
      ["core", core.version, "active", []],
      ["asker", "1.0.0", "shadow", ["asker:q0"]],
    ]);
    expect(outputs[1]!.outputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("relaxations", () => {
  const proposer = (target: string, needs: string[]) =>
    defineExtension({
      id: "proposer",
      version: "1.0.0",
      title: "Proposer",
      summary: "Test extension.",
      needs,
      config: { schema: z.object({ allow: z.boolean().default(false) }), fields: [{ key: "allow", label: "Allow", help: "", kind: "boolean", loosens: true }] },
      relaxations: [{ kind: "council-may-pass", field: "allow" }],
      detect: () => ({ relax: [{ question: target, kind: "council-may-pass", why: "verified switched off behind newCheckout" }] }),
    });

  it("applies only when the proposer is Active, its loosens setting is on, and it needs the target's extension", () => {
    const cases: [object, string[], string | null][] = [
      [{ mode: "active", allow: true }, ["core"], null],
      [{ mode: "shadow", allow: true }, ["core"], "proposer is not in Active mode"],
      [{ mode: "active", allow: false }, ["core"], "the setting proposer.allow is off"],
      [{ mode: "active", allow: true }, [], "proposer does not list core in its needs"],
    ];
    for (const [section, needs, refused] of cases) {
      restore?.();
      use(proposer("core:sensitive-path", needs));
      const { questions, relaxations } = runExtensions(run(SENSITIVE), parseConfig({ ...base, extensions: { proposer: section } }), { now: 0 });
      expect(relaxations[0]!.refused).toBe(refused);
      expect(questions[0]!.councilMayPass).toBe(refused === null);
      if (refused === null) expect(questions[0]!.relaxedBy).toEqual({ extension: "proposer", kind: "council-may-pass", why: "verified switched off behind newCheckout" });
    }
  });

  it("no combination of config and extension output relaxes a never-relax question", () => {
    const threats = defineExtension({
      ...asker,
      id: "threat-model",
      detect: () => ({
        questions: [
          { key: "T3", prompt: "Weakens T3?", summary: "s", evidence: [], councilMayPass: false },
          { key: "entry-point-1", prompt: "New way in?", summary: "s", evidence: [], councilMayPass: false },
          { key: "rule", prompt: "Rule?", summary: "s", evidence: [], councilMayPass: false, neverRelax: true },
        ],
      }),
    });
    const random = seeded(7);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]!;
    for (let i = 0; i < 200; i++) {
      const target = pick(["threat-model:T3", "threat-model:entry-point-1", "threat-model:rule", "threat-model:extension-error", "core:sensitive-path"]);
      restore?.();
      use(threats, proposer(target, pick([["core", "threat-model"], ["threat-model"], []])));
      const config = parseConfig({ ...base, extensions: { "threat-model": { mode: pick(["shadow", "active"]), maxQuestions: 5 }, proposer: { mode: pick(["shadow", "active"]), allow: random() < 0.7 } } });
      const { questions } = runExtensions(run(SENSITIVE), config, { now: 0 });
      for (const q of questions) {
        if (neverRelaxed(q)) {
          expect(q.councilMayPass, q.id).toBe(false);
          expect(q.relaxedBy, q.id).toBeUndefined();
        }
      }
    }
  });
});

describe("runs stored before extensions", () => {
  it("read an old parsed config and old question ids as today's", async () => {
    const { storedConfig, storedDecision } = await import("./stored");
    const oldConfig = { requiredWorkflows: ["ci"], flaky: { knownTests: [], rerun: false }, triggers: { "sensitive-path": { councilMayPass: true } }, sensitivePaths: { off: [], extraGlobs: [] }, council: { seats: ["s"], passStrength: 4, needsPersonBlocksPass: true }, ask: { to: "x", deadlineMinutes: 240, onNoAnswer: "fail", onNoAnswerAfterBackup: "fail", perTrigger: { "flaky-test": "pass" }, remind: true } };
    const config = storedConfig(oldConfig);
    expect((config.extensions.core!.config as { triggers: Record<string, { councilMayPass: boolean }> }).triggers["sensitive-path"]!.councilMayPass).toBe(true);
    expect(config.ask.perExtension).toEqual({ "core:flaky-test": "pass" });
    expect(storedConfig(config)).toBe(config);
    const decision = storedDecision({ result: "pass", reason: "", hardFailures: [], councilCalls: 0, costUsd: 0, questions: [{ question: { id: "flaky-test", trigger: "flaky-test", prompt: "p", summary: "s", evidence: [], councilMayPass: true }, seats: [], outcome: "pass", decidedBy: "council", reason: "" }] });
    expect(decision.questions[0]!.question).toEqual({ id: "core:flaky-test", extension: "core", key: "flaky-test", shadow: false, prompt: "p", summary: "s", evidence: [], councilMayPass: true });
    expect(decision.extensions).toBeNull();
  });
});

describe("every bundled extension", () => {
  it("notes never change a result, on any fixture, with every bundled extension on", async () => {
    const dir = fileURLToPath(new URL("../../../fixtures", import.meta.url));
    const { loadFixtures } = await import("./fixtures");
    for (const f of loadFixtures(dir)) {
      const all = { ...Object.fromEntries(BUNDLED.map((e) => [e.id, { mode: "active" }])), ...f.config.extensions };
      const config = parseConfig({ ...f.config, extensions: Object.fromEntries(Object.entries(all).map(([id, s]) => [id, "config" in s ? { mode: s.mode, ...s.config } : s])) });
      const council = () => fixedCouncil({ verdict: "needs-person", strength: 3, reason: "", quotes: [] });
      const withNotes = await decideRun(f.run, config, council(), { now: 0 });
      restore = replaceExtensionsForTest(BUNDLED.map((e) => ({ ...e, notes: undefined })));
      const without = await decideRun(f.run, config, council(), { now: 0 });
      restore();
      restore = null;
      expect([withNotes.result, withNotes.reason, withNotes.questions], f.name).toEqual([without.result, without.reason, without.questions]);
    }
  });
});

describe("describing extensions", () => {
  it("gives every bundled extension's settings, defaults and a JSON Schema of its config", () => {
    const list = describeExtensions();
    expect(list.map((e) => e.id)).toEqual(BUNDLED.map((e) => e.id));
    const threat = list.find((e) => e.id === "threat-model")!;
    expect(threat).toMatchObject({ defaultMode: "off", defaults: { path: "THREATS.md", controlsCouncilMayPass: false } });
    expect(threat.fields.find((f) => f.key === "controlsCouncilMayPass")!.loosens).toBe(true);
    expect(threat.configSchema).toMatchObject({ type: "object", properties: { path: { type: "string" } } });
    expect(list.find((e) => e.id === "core")!.defaultMode).toBe("active");
  });
});
