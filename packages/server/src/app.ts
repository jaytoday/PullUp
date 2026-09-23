// PullUp's local JSON API. Every handler is a thin call into the same core
// functions the CLI uses (buildReport, prepareJevRuntime, planReviewActions…),
// so the dashboard can never disagree with the CLI.
//
// GETs have no side effects: they read cached signals only. Model calls, logged
// review actions, and calibration happen on explicit POSTs. Nothing here posts
// to GitHub — approval authority is stubbed (LoggingReviewActuator).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import {
  CHANGE_TYPES,
  LoggingReviewActuator,
  QUESTION_SETS,
  buildReport,
  calibrateRepo,
  costCurve,
  evaluatePolicy,
  findOptimalWait,
  ingestRepo,
  loadCalibration,
  loadPullSignals,
  planReviewActions,
  runSignals,
} from "@pullup/core";
import type { JevMode, PullStore, PullupReport, ResolvedConfig } from "@pullup/core";
import { loadFixture } from "@pullup/github";
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
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
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
  return cfg.jev.calibrationPath ?? join(deps.dataDir ?? ".pullup", `calibration.${repoId.replace("/", "__")}.json`);
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
  const now = deps.now ?? (() => new Date().toISOString());

  async function ensureRepo(repoId: string): Promise<void> {
    if (!(await deps.store.getRepository(repoId))) throw new HttpError(404, `Repo ${repoId} is not ingested.`);
  }

  /** Report with the Jev layer resolved for `mode` — cached signals only (no model calls). */
  async function report(repoId: string, mode: JevMode, cfg: ResolvedConfig) {
    const calibrationPath = calibrationPathFor(deps, cfg, repoId);
    const { runtime } = await prepareJevRuntime(deps.store, repoId, cfg, {
      mode,
      evaluate: false,
      ...(existsSync(calibrationPath) ? { calibrationPath } : {}),
    });
    const r = await buildReport(deps.store, repoId, cfg.priors, {
      now: now(),
      jev: runtime ?? undefined,
      configPath: cfg.path,
    });
    return { report: r, runtime };
  }

  async function withActions(r: PullupReport, repoId: string, cfg: ResolvedConfig) {
    return planReviewActions(r.decisions, await deps.store.listPulls(repoId), {
      repoId,
      humanReviewers: cfg.jev.humanReviewers,
    });
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
        const cfg = deps.config();
        const { report: r } = await report(repoId, parseMode(url, cfg), cfg);
        return {
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
        const cfg = deps.config();
        const mode = parseMode(url, cfg);
        const { report: r, runtime } = await report(repoId, mode, cfg);
        const decision = r.decisions.find((d) => d.pullNumber === n);
        const pull = await deps.store.getPull(repoId, n);
        if (!decision || !pull) throw new HttpError(404, `PR #${n} not found in ${repoId}.`);

        const qs = runtime?.qs ?? QUESTION_SETS[cfg.jev.questionSet]!;
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
          questionSet: { version: qs.version, sensitive: qs.sensitive, escalating: qs.escalating, injection: qs.injection, lowRisk: qs.lowRisk },
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
        const path = calibrationPathFor(deps, deps.config(), repoId);
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
        const cfg = deps.config();
        const qs = QUESTION_SETS[cfg.jev.questionSet]!;
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
        const cfg = deps.config();
        const { report: r } = await report(repoId, parseMode(url, cfg), cfg);
        const planned = await withActions(r, repoId, cfg);
        const logged = await new LoggingReviewActuator(deps.store, now).apply(planned);
        return { logged, sent: 0 };
      },
    ],
    [
      "POST",
      /^\/api\/repos\/([^/]+)\/([^/]+)\/calibrate$/,
      async (m) => {
        const repoId = `${m[1]}/${m[2]}`;
        await ensureRepo(repoId);
        const cfg = deps.config();
        const qs = QUESTION_SETS[cfg.jev.questionSet]!;
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
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      if (err instanceof z.ZodError) return json(res, 400, { error: err.issues.map((i) => i.message).join("; ") });
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
