// PullUp's local JSON API. Every handler is a thin call into the same core
// functions the CLI uses (buildReport, prepareJevRuntime, planReviewActions…),
// so the dashboard can never disagree with the CLI.
//
// GETs have no side effects: they read cached signals only. Model calls, review
// actions, and calibration happen on explicit POSTs. Review actions are logged
// unless the operator set PULLUP_GITHUB_DELIVERY=live, in which case POST
// …/actions sends them to GitHub (Approve · Act still needs the repo's
// fast-path calibration gate — see approvalGate).
//
// Every plan then goes through governPlan (Agent Baseline authority layer,
// docs/authority.md): GETs show the authorization without issuing permits;
// POST …/actions issues permits and the actuator re-checks them. The
// dashboard can turn the stop switch ON (it only removes authority) but never
// off, and can never enroll a repo or approve an agent — those are CLI-only,
// because this API has no authentication.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import {
  AGENT_IDS,
  CHANGE_TYPES,
  ConfigVersionConflictError,
  GLOBAL_SCOPE,
  PROFILE_HINT,
  PROFILE_LABEL,
  agentIdentity,
  ensureAgent,
  evidenceSheet,
  governPlan,
  loadControlSnapshot,
  resolvePermitKey,
  stopPullUp,
  verifyEvidenceChain,
  approvalGate,
  calibrationPathFor as defaultCalibrationPath,
  buildReport,
  buildUnits,
  calibrateRepo,
  configFileSchema,
  configReportOptions,
  costCurve,
  customQuestionId,
  customQuestionText,
  diffConfig,
  effectiveConfigFile,
  evaluatePolicy,
  evaluateRepoGuardrails,
  findOptimalWait,
  ingestRepo,
  loadCalibration,
  loadPullSignals,
  loosening,
  namedModeOf,
  planReviewActions,
  previewConfig,
  resolveDelivery,
  resolveQuestionSet,
  runSignals,
  screenCustomQuestion,
  withRepoLayer,
} from "@pullup/core";
import type {
  ConfigFile,
  ConfigVersionRecord,
  JevMode,
  PullStore,
  PullupReport,
  QuestionSet,
  ResolvedConfig,
  AgentIdentity,
  CredentialKind,
} from "@pullup/core";
import type { CredentialBroker } from "@pullup/github";
import { createReviewActuator, credentialKind, loadFixture } from "@pullup/github";
import { prepareJevRuntime, resolveSignalModel } from "@pullup/jev";
import { z } from "zod";

export interface AppDeps {
  readonly store: PullStore;
  readonly config: () => ResolvedConfig;
  /** Fixed clock for reproducible views (dev/test); default: wall clock. */
  readonly now?: () => string;
  /** Directory of bundled fixtures for the dev-only ingest endpoint. */
  readonly fixturesDir?: string;
  /** Where calibration artifacts are written/read when config names none. */
  readonly dataDir?: string;
  /** Built web assets to serve (production); omit in dev (Vite serves them). */
  readonly staticDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowIngest?: boolean;
  /** GitHub credential broker override (tests); default: from env (App, else personal token). */
  readonly broker?: CredentialBroker;
  /** This process's agent identity override (tests); default: `pullup/dashboard` at this build. */
  readonly agent?: AgentIdentity;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** zod issues → `{ path, message }` for inline form errors. */
function issuesOf(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

const modeSchema = z.enum(["off", "shadow", "active"]);

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Body is not valid JSON.");
  }
}

function parseMode(url: URL, cfg: ResolvedConfig): JevMode {
  const raw = url.searchParams.get("mode");
  if (raw === null) return cfg.jev.mode;
  const parsed = modeSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, `mode must be off | shadow | active (got "${raw}")`);
  return parsed.data;
}

export function calibrationPathFor(deps: AppDeps, cfg: ResolvedConfig, repoId: string): string {
  return defaultCalibrationPath(cfg.jev, repoId, deps.dataDir);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".json": "application/json",
};

export function createApp(deps: AppDeps) {
  const env = deps.env ?? process.env;
  const delivery = resolveDelivery(env);
  const now = deps.now ?? (() => new Date().toISOString());
  const agent = deps.agent ?? agentIdentity({ id: AGENT_IDS.dashboard });
  const permitKey = resolvePermitKey(env);
  const credential: CredentialKind | null = deps.broker?.kind ?? credentialKind(env);

  async function ensureRepo(repoId: string): Promise<void> {
    if (!(await deps.store.getRepository(repoId))) throw new HttpError(404, `Repo ${repoId} is not ingested.`);
  }

  async function latestVersion(repoId: string): Promise<ConfigVersionRecord | null> {
    return (await deps.store.listConfigVersions(repoId)).at(-1) ?? null;
  }

  /** File config with the repo's latest saved version layered on top. */
  async function configFor(repoId: string): Promise<ResolvedConfig> {
    return withRepoLayer(deps.config(), await latestVersion(repoId));
  }

  /** The file config with a *draft* repo layer (validated) on top. */
  function draftConfig(base: ResolvedConfig, repoLayer: ConfigFile, version: number | null): ResolvedConfig {
    return withRepoLayer(base, {
      repoId: "",
      version: version ?? 0,
      config: repoLayer,
      hash: "",
      note: "",
      loosened: [],
      author: "",
      createdAt: "",
      restoredFrom: null,
    });
  }

  function parseRepoLayer(raw: unknown): ConfigFile {
    const parsed = configFileSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new HttpError(400, "Config is invalid.", { issues: issuesOf(parsed.error) });
    }
    return parsed.data;
  }

  /** Jev runtime for `mode` — cached signals only (no model calls). */
  async function jevRuntime(repoId: string, mode: JevMode, cfg: ResolvedConfig) {
    const calibrationPath = calibrationPathFor(deps, cfg, repoId);
    const { runtime } = await prepareJevRuntime(deps.store, repoId, cfg, {
      mode,
      evaluate: false,
      ...(existsSync(calibrationPath) ? { calibrationPath } : {}),
    });
    return runtime;
  }

  /** Report with the Jev layer resolved for `mode` — cached signals only (no model calls). */
  async function report(repoId: string, mode: JevMode, cfg: ResolvedConfig) {
    const runtime = await jevRuntime(repoId, mode, cfg);
    const r = await buildReport(deps.store, repoId, cfg.priors, {
      now: now(),
      jev: runtime ?? undefined,
      configPath: cfg.path,
      ...configReportOptions(cfg),
    });
    return { report: r, runtime };
  }

  function approvalFor(repoId: string, cfg: ResolvedConfig) {
    const path = calibrationPathFor(deps, cfg, repoId);
    const calibration = existsSync(path) ? loadCalibration(path) : null;
    return { calibration, gate: approvalGate({ repoId, delivery, calibration }) };
  }

  /**
   * The planned actions, governed. `sign` issues permits (only the POST that
   * sends); read-only views show the authorization without one.
   */
  async function withActions(r: PullupReport, repoId: string, cfg: ResolvedConfig, sign = false) {
    const { gate } = approvalFor(repoId, cfg);
    const planned = planReviewActions(r.decisions, await deps.store.listPulls(repoId), {
      repoId,
      humanReviewers: cfg.jev.humanReviewers,
      authority: cfg.authority,
      configVersion: cfg.version,
      approvalUnlocked: gate.unlocked,
      ...(gate.reason ? { approvalLockedReason: gate.reason } : {}),
    });
    return governPlan(deps.store, planned, {
      repoId,
      initiator: { kind: "dashboard", ref: null },
      agent,
      config: { version: cfg.version, hash: cfg.hash },
      risk: { questionSet: r.risk?.questionSetVersion ?? null, modelId: r.risk?.modelId ?? null },
      delivery,
      credential,
      permitKey,
      sign,
      now: now(),
    });
  }

  /** Saves a new repo config version (shared by save and restore). */
  async function saveVersion(
    repoId: string,
    body: { config: ConfigFile; note: string; baseVersion: number | null; confirmLoosen?: string; restoredFrom?: number | null },
  ) {
    const current = await configFor(repoId);
    if ((current.version ?? null) !== body.baseVersion) {
      throw new HttpError(409, new ConfigVersionConflictError(body.baseVersion, current.version).message, {
        conflict: true,
        latest: current.version,
      });
    }
    const next = draftConfig(current, body.config, current.version);
    const changes = diffConfig(effectiveConfigFile(current.file, current.repo), effectiveConfigFile(next.file, next.repo));
    if (changes.length === 0 && body.restoredFrom == null) throw new HttpError(400, "No changes to save.");
    const loosened = loosening(changes);
    if (loosened.length > 0 && body.confirmLoosen !== repoId) {
      throw new HttpError(409, `This loosens the gate: type the repo name (${repoId}) to confirm.`, {
        needsConfirm: true,
        loosened,
      });
    }
    try {
      const saved = await deps.store.appendConfigVersion(
        {
          repoId,
          config: body.config,
          hash: next.hash,
          note: body.note,
          loosened: loosened.map((c) => c.path),
          author: "local",
          createdAt: now(),
          restoredFrom: body.restoredFrom ?? null,
        },
        current.version,
      );
      return { version: saved, changes };
    } catch (err) {
      if (err instanceof ConfigVersionConflictError) {
        throw new HttpError(409, err.message, { conflict: true, latest: err.actual });
      }
      throw err;
    }
  }

  type Handler = (m: RegExpMatchArray, url: URL, req: IncomingMessage) => Promise<unknown>;
  const routes: Array<[string, RegExp, Handler]> = [
    [
      "GET",
      /^\/api\/health$/,
      async () => ({ ok: true }),
    ],
    [
      "GET",
      /^\/api\/config$/,
      async () => {
        const cfg = deps.config();
        const resolved = resolveSignalModel({ config: cfg.jev, env });
        return {
          path: cfg.path,
          fileOverrides: cfg.fileOverrides,
          priors: cfg.priors,
          jev: cfg.jev,
          policy: cfg.policy,
          guardrails: cfg.guardrails,
          authority: cfg.authority,
          hash: cfg.hash,
          // Presence only — never the value.
          env: { typesafeApiKey: Boolean(env.TYPESAFE_API_KEY), signalModel: resolved.kind, signalModelId: resolved.model.id },
          fixtures: deps.allowIngest ? listFixtures(deps.fixturesDir) : [],
        };
      },
    ],
    [
      "GET",
      /^\/api\/repos$/,
      async () => {
        const ids = await deps.store.listRepositories();
        return Promise.all(
          ids.sort().map(async (repoId) => {
            const repo = await deps.store.getRepository(repoId);
            const runs = await deps.store.listSignalRuns(repoId);
            const pulls = await deps.store.listPulls(repoId);
            return {
              repoId,
              ingestedAt: repo?.ingestedAt ?? null,
              pulls: pulls.length,
              open: pulls.filter((p) => p.state === "open").length,
              lastSignalRun: runs.at(-1) ?? null,
            };
          }),
        );
      },
    ],
    [
      "GET",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/report$/,
      async (m, url) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const cfg = await configFor(repoId);
        const { report: r } = await report(repoId, parseMode(url, cfg), cfg);
        return {
          mode: namedModeOf(cfg.authority),
          report: r,
          actions: await withActions(r, repoId, cfg),
          // Per-type w* (the report's own summary line), computed server-side.
          maxWaitByType: Object.fromEntries(CHANGE_TYPES.map((t) => [t, findOptimalWait(r.params, t)])),
        };
      },
    ],
    [
      "GET",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/,
      async (m, url) => {
        const repoId = `${m[1]}/${m[2]}`;
        const n = Number(m[3]);
        await ensureRepo(repoId);
        const cfg = await configFor(repoId);
        const mode = parseMode(url, cfg);
        const { report: r, runtime } = await report(repoId, mode, cfg);
        const decision = r.decisions.find((d) => d.pullNumber === n);
        const pull = await deps.store.getPull(repoId, n);
        if (!decision || !pull) throw new HttpError(404, `PR #${n} not found in ${repoId}.`);

        const qs = runtime?.qs ?? resolveQuestionSet(cfg.jev);
        const modelId = runtime?.modelId ?? resolveSignalModel({ config: cfg.jev, env }).model.id;
        const signals = await loadPullSignals(deps.store, pull, qs, modelId);
        const pDefect = decision.risk?.mode === "active" ? decision.risk.pDefect : undefined;
        const horizon = Math.min(
          r.params.maxWaitHoursCap,
          Math.max(48, Math.ceil(Math.max(decision.maxWaitHours, decision.risk?.shadowMaxWaitHours ?? 0, decision.waitHours) * 1.4)),
        );
        const planned = (await withActions(r, repoId, cfg)).find((a) => a.pullNumber === n) ?? null;
        const logged = await deps.store.listReviewActions(repoId, n);

        return {
          repoId,
          generatedAt: r.generatedAt,
          pull: {
            number: pull.number,
            title: pull.title,
            author: pull.author,
            state: pull.state,
            headSha: pull.headSha,
            createdAt: pull.createdAt,
            labels: pull.labels,
            files: pull.files,
            additions: pull.additions,
            deletions: pull.deletions,
            changeType: pull.changeType,
            area: pull.area,
            sizeBucket: pull.sizeBucket,
          },
          decision,
          policy: evaluatePolicy(pull.files, cfg.policy),
          thresholds: cfg.jev.thresholds,
          questionSet: {
            version: qs.version,
            sensitive: qs.sensitive,
            escalating: qs.escalating,
            injection: qs.injection,
            lowRisk: qs.lowRisk,
            custom: qs.custom ?? [],
            texts: Object.fromEntries(Object.entries(qs.questions).map(([id, q]) => [id, q.text])),
          },
          modelId,
          units: signals.units.map((u, i) => ({
            key: u.key,
            path: u.path,
            hunk: u.state.hunk,
            noPatch: u.noPatch,
            oversize: u.oversize,
            answers: signals.answers[i] ?? null,
          })),
          curve: costCurve(r.params, pull.changeType, horizon, { pDefect }),
          plannedAction: planned,
          loggedActions: logged,
        };
      },
    ],
    [
      "GET",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/actions$/,
      async (m) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const actions = await deps.store.listReviewActions(repoId);
        return actions.sort((a, b) => b.loggedAt.localeCompare(a.loggedAt) || a.pullNumber - b.pullNumber);
      },
    ],
    [
      "GET",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/signal-runs$/,
      async (m) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        return (await deps.store.listSignalRuns(repoId)).reverse();
      },
    ],
    [
      "GET",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/calibration$/,
      async (m) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const path = calibrationPathFor(deps, await configFor(repoId), repoId);
        // "Not calibrated yet" is a normal state, not an error.
        return { path, artifact: existsSync(path) ? loadCalibration(path) : null };
      },
    ],
    [
      "POST",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/signals$/,
      async (m, _url, req) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const body = z
          .object({ scope: z.enum(["open", "all"]).default("open") })
          .parse(await readBody(req));
        const cfg = await configFor(repoId);
        const qs = resolveQuestionSet(cfg.jev);
        const { model, note } = resolveSignalModel({ config: cfg.jev, env });
        const run = await runSignals(deps.store, repoId, model, qs, {
          openOnly: body.scope === "open",
          budgetUsd: cfg.jev.budgetUsdPerRun,
          now: now(),
        });
        return { run, note };
      },
    ],
    [
      "POST",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/actions$/,
      async (m, url) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const cfg = await configFor(repoId);
        const { report: r } = await report(repoId, parseMode(url, cfg), cfg);
        await ensureAgent(deps.store, agent, now());
        const planned = await withActions(r, repoId, cfg, true);
        const actuator = await createReviewActuator(deps.store, repoId, {
          delivery,
          env,
          now,
          ...(deps.broker ? { broker: deps.broker } : {}),
          guard: { permitKey, agent, configHash: async (id) => (await configFor(id)).hash },
        }).catch((err: Error) => {
          throw new HttpError(503, `Live GitHub delivery is on, but ${err.message}`);
        });
        const records = await actuator.apply(planned);
        return {
          // `logged` = every record, whatever its status (kept for older clients).
          logged: records,
          delivery: actuator.kind === "github" ? "live" : "log",
          sent: records.filter((a) => a.status === "sent").length,
          failed: records.filter((a) => a.status === "failed").length,
          denied: records.filter((a) => a.status === "denied").length,
          mode: namedModeOf(cfg.authority),
        };
      },
    ],
    [
      "POST",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/calibrate$/,
      async (m) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const cfg = await configFor(repoId);
        const qs = resolveQuestionSet(cfg.jev);
        const { model } = resolveSignalModel({ config: cfg.jev, env });
        const run = await runSignals(deps.store, repoId, model, qs, { budgetUsd: cfg.jev.budgetUsdPerRun, now: now() });
        const artifact = await calibrateRepo(deps.store, repoId, cfg.priors, qs, model.id, {
          policy: cfg.policy,
          config: cfg.jev,
          now: now(),
        });
        const path = calibrationPathFor(deps, cfg, repoId);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(artifact, null, 2) + "\n");
        return { path, artifact, run };
      },
    ],
    [
      "GET",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/config$/,
      async (m) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const cfg = await configFor(repoId);
        const versions = await deps.store.listConfigVersions(repoId);
        const { calibration: artifact, gate } = approvalFor(repoId, cfg);
        return {
          repoId,
          path: cfg.path,
          version: cfg.version,
          hash: cfg.hash,
          mode: namedModeOf(cfg.authority),
          file: cfg.file,
          repo: cfg.repo ?? {},
          effective: effectiveConfigFile(cfg.file, cfg.repo),
          sources: cfg.sources,
          latest: versions.at(-1) ?? null,
          versionCount: versions.length,
          // Approve · Act stays locked until this gate passes *and* delivery is live.
          approval: {
            fastPathGatePassed: artifact?.fastPathGate.passed ?? false,
            liveActuator: delivery === "live",
            unlocked: gate.unlocked,
            lockedReason: gate.reason,
          },
          questionSet: (() => {
            const base = resolveQuestionSet({ ...cfg.jev, customQuestions: [], disabledQuestions: [] });
            return { version: resolveQuestionSet(cfg.jev).version, builtIn: base.sensitive, escalating: base.escalating };
          })(),
        };
      },
    ],
    [
      "GET",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/config\/versions$/,
      async (m) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const base = deps.config();
        const versions = await deps.store.listConfigVersions(repoId);
        // Each version with its field-level diff against the one before it.
        return versions
          .map((v, i) => {
            const prev = i > 0 ? versions[i - 1]!.config : null;
            return {
              ...v,
              changes: diffConfig(effectiveConfigFile(base.file, prev), effectiveConfigFile(base.file, v.config)),
            };
          })
          .reverse();
      },
    ],
    [
      "POST",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/config\/validate$/,
      async (m, _url, req) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const { config } = z.object({ config: z.unknown() }).parse(await readBody(req));
        const parsed = configFileSchema.safeParse(config ?? {});
        if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error), changes: [], loosened: [] };
        const current = await configFor(repoId);
        const next = draftConfig(current, parsed.data, current.version);
        const changes = diffConfig(effectiveConfigFile(current.file, current.repo), effectiveConfigFile(next.file, next.repo));
        return { ok: true, issues: [], changes, loosened: loosening(changes), hash: next.hash, mode: namedModeOf(next.authority) };
      },
    ],
    [
      "POST",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/config\/preview$/,
      async (m, _url, req) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const { config } = z.object({ config: z.unknown() }).parse(await readBody(req));
        const current = await configFor(repoId);
        const draft = draftConfig(current, parseRepoLayer(config), current.version);
        return previewConfig(
          deps.store,
          repoId,
          { config: current, jev: await jevRuntime(repoId, current.jev.mode, current) },
          { config: draft, jev: await jevRuntime(repoId, draft.jev.mode, draft) },
          { now: now() },
        );
      },
    ],
    [
      "POST",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/config$/,
      async (m, _url, req) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const body = z
          .object({
            config: z.unknown(),
            note: z.string().trim().max(200).default(""),
            baseVersion: z.number().int().min(1).nullable(),
            confirmLoosen: z.string().optional(),
          })
          .parse(await readBody(req));
        return saveVersion(repoId, { ...body, config: parseRepoLayer(body.config) });
      },
    ],
    [
      "POST",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/config\/restore\/(\d+)$/,
      async (m, _url, req) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const body = z
          .object({ baseVersion: z.number().int().min(1).nullable(), confirmLoosen: z.string().optional() })
          .parse(await readBody(req));
        const target = (await deps.store.listConfigVersions(repoId)).find((v) => v.version === Number(m[3]));
        if (!target) throw new HttpError(404, `No config version ${m[3]} for ${repoId}.`);
        return saveVersion(repoId, {
          config: parseRepoLayer(target.config),
          note: `Restored v${target.version}${target.note ? ` (${target.note})` : ""}`,
          baseVersion: body.baseVersion,
          confirmLoosen: body.confirmLoosen,
          restoredFrom: target.version,
        });
      },
    ],
    [
      "GET",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/stats\/sizes$/,
      async (m) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const cfg = await configFor(repoId);
        // Sizes counted the way the size guardrail counts them (excludes applied).
        const results = await evaluateRepoGuardrails(deps.store, repoId, cfg.policy, cfg.guardrails, now(), {
          states: ["merged"],
        });
        const merged = (await deps.store.listMergedPulls(repoId))
          .sort((a, b) => (b.mergedAt ?? "").localeCompare(a.mergedAt ?? ""))
          .slice(0, 500);
        const rows = merged.map((p) => results.get(p.number)).filter((r) => r !== undefined);
        return { count: rows.length, lines: rows.map((r) => r.lines), files: rows.map((r) => r.files) };
      },
    ],
    [
      "POST",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/questions\/try$/,
      async (m, _url, req) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const body = z
          .object({ text: z.string(), pullNumber: z.number().int().optional() })
          .parse(await readBody(req));
        const screened = screenCustomQuestion(body.text);
        if (!screened.ok) {
          throw new HttpError(400, `Custom question ${screened.problems[0]}.`, {
            issues: screened.problems.map((p) => ({ path: "text", message: p })),
          });
        }
        const pulls = await deps.store.listPulls(repoId);
        const pull =
          body.pullNumber !== undefined
            ? pulls.find((p) => p.number === body.pullNumber)
            : [...pulls].filter((p) => p.state === "open").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (!pull) throw new HttpError(404, "No PR to try the question on.");
        const cfg = await configFor(repoId);
        const id = customQuestionId(screened.normalized);
        // A one-question set: nothing else is asked, and nothing is cached.
        const qs: QuestionSet = {
          version: "try",
          questions: { [id]: { kind: "noul", text: customQuestionText(screened.normalized) } },
          sensitive: [],
          escalating: [],
          lowRisk: [],
          injection: "",
          changeKind: "",
          lowRiskKinds: [],
          blastRadius: "",
          custom: [id],
        };
        const units = buildUnits(await deps.store.listHunks(repoId, pull.number), qs, { area: pull.area }).slice(0, 20);
        const { model, note } = resolveSignalModel({ config: cfg.jev, env });
        const answers = await model.evaluate(units, qs);
        return {
          question: customQuestionText(screened.normalized),
          pullNumber: pull.number,
          title: pull.title,
          model: model.id,
          note,
          units: units.map((u, i) => {
            const a = answers[i]?.answers[id];
            return { key: u.key, path: u.path, p: a && a.kind === "noul" ? a.p : null };
          }),
        };
      },
    ],
    [
      "GET",
      /^\/api\/control$/,
      async () => {
        const stop = await deps.store.getControlState(GLOBAL_SCOPE);
        const known = await deps.store.getAgent(agent.id, agent.version);
        return {
          stop: stop ?? { scope: GLOBAL_SCOPE, stopped: false, reason: "", by: "", at: "" },
          agent: { id: agent.id, version: agent.version, status: known?.status ?? "pending", registered: Boolean(known) },
          agents: await deps.store.listAgents(),
          delivery,
          // Presence only — never the value.
          permitKey: permitKey !== null,
          credential,
        };
      },
    ],
    [
      "POST",
      /^\/api\/control\/stop$/,
      async (_m, _url, req) => {
        const body = z
          .object({ scope: z.string().min(1).default(GLOBAL_SCOPE), reason: z.string().trim().max(200).default("") })
          .parse(await readBody(req));
        if (body.scope !== GLOBAL_SCOPE) await ensureRepo(body.scope);
        // Stopping only removes authority, so it needs no confirmation. Resuming is CLI-only.
        return stopPullUp(deps.store, { scope: body.scope, reason: body.reason, by: "dashboard", now: now() });
      },
    ],
    [
      "GET",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/control$/,
      async (m) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const snapshot = await loadControlSnapshot(deps.store, repoId, agent);
        const enrollment = await deps.store.getEnrollment(repoId);
        return {
          repoId,
          profile: { id: snapshot.profile, label: PROFILE_LABEL[snapshot.profile], hint: PROFILE_HINT[snapshot.profile], enrolled: Boolean(enrollment), by: enrollment?.by ?? null, at: enrollment?.at ?? null },
          stop: snapshot.stop,
          repoStop: await deps.store.getControlState(repoId),
          agent: { id: agent.id, version: agent.version, status: snapshot.agentStatus },
        };
      },
    ],
    [
      "GET",
      /^\/api\/tasks\/([A-Za-z0-9_-]+)\/evidence$/,
      async (m) => {
        const rows = await deps.store.listEvidence({ taskId: m[1]! });
        const sheet = evidenceSheet(m[1]!, rows);
        if (!sheet) throw new HttpError(404, `No evidence for task ${m[1]}.`);
        // The whole repo chain is checked, so an edit anywhere before this task shows.
        return { ...sheet, chain: verifyEvidenceChain(await deps.store.listEvidence({ repoId: sheet.repoId })) };
      },
    ],
    [
      "POST",
      /^\/api\/ingest$/,
      async (_m, _url, req) => {
        if (!deps.allowIngest || !deps.fixturesDir) throw new HttpError(403, "Fixture ingest is disabled.");
        const { fixture } = z.object({ fixture: z.string().regex(/^[a-z0-9-]+$/) }).parse(await readBody(req));
        const path = join(deps.fixturesDir, `${fixture}.json`);
        if (!existsSync(path)) throw new HttpError(404, `No fixture "${fixture}".`);
        return ingestRepo(loadFixture(path, `fixtures/${fixture}`), deps.store, { now: now() });
      },
    ],
  ];

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        for (const [method, re, handler] of routes) {
          const m = url.pathname.match(re);
          if (m && req.method === method) return json(res, 200, await handler(m, url, req));
        }
        throw new HttpError(404, `No route for ${req.method} ${url.pathname}`);
      }
      if (deps.staticDir && req.method === "GET") return serveStatic(deps.staticDir, url.pathname, res);
      throw new HttpError(404, "Not found");
    } catch (err) {
      if (err instanceof HttpError) return json(res, err.status, { error: err.message, ...err.details });
      if (err instanceof z.ZodError) {
        return json(res, 400, { error: err.issues.map((i) => i.message).join("; "), issues: issuesOf(err) });
      }
      console.error(err);
      return json(res, 500, { error: (err as Error).message });
    }
  };
}

function listFixtures(dir: string | undefined): string[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.includes("replay"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

function serveStatic(root: string, pathname: string, res: ServerResponse): void {
  const base = resolve(root);
  let file = resolve(base, "." + decodeURIComponent(pathname));
  // Never serve outside the build dir; unknown paths get the SPA shell.
  if (!file.startsWith(base + sep) || !existsSync(file) || !/\.[a-z0-9]+$/i.test(file)) {
    file = join(base, "index.html");
  }
  const ext = file.slice(file.lastIndexOf("."));
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(readFileSync(file));
}
