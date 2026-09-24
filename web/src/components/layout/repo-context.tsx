import { useParams } from "@solidjs/router";
import {
  createContext,
  createResource,
  createSignal,
  useContext,
  type Accessor,
  type ParentComponent,
  type Resource,
} from "solid-js";
import { api, type JevMode, type ReportResponse } from "@/lib/api";
import { useMode } from "@/lib/state";
import { showToast } from "@/components/ui/toast";
import { useApp } from "./app-context";
import { usd } from "@/lib/format";

interface RepoContextValue {
  repoId: Accessor<string>;
  mode: Accessor<JevMode>;
  setMode: (m: JevMode) => void;
  report: Resource<ReportResponse>;
  /** Bumped after any mutation so dependent resources refetch. */
  version: Accessor<number>;
  refresh: () => void;
  busy: Accessor<string | null>;
  runSignals: () => Promise<void>;
  logActions: () => Promise<void>;
  calibrate: () => Promise<void>;
}

const RepoContext = createContext<RepoContextValue>();

/** One report per (repo, mode, version), shared by every page under /r/:owner/:repo. */
export const RepoProvider: ParentComponent = (props) => {
  const params = useParams<{ owner: string; repo: string }>();
  const { refetchRepos } = useApp();
  const [mode, setMode] = useMode();
  const [version, setVersion] = createSignal(0);
  const [busy, setBusy] = createSignal<string | null>(null);
  const repoId = () => `${params.owner}/${params.repo}`;

  const [report] = createResource(
    () => ({ repoId: repoId(), mode: mode(), v: version() }),
    (k) => api.report(k.repoId, k.mode),
  );

  const refresh = () => {
    setVersion((v) => v + 1);
    refetchRepos();
  };

  async function guarded(label: string, fn: () => Promise<void>) {
    if (busy()) return;
    setBusy(label);
    try {
      await fn();
      refresh();
    } catch (err) {
      showToast({ title: `${label} failed`, description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const value: RepoContextValue = {
    repoId,
    mode,
    setMode,
    report,
    version,
    refresh,
    busy,
    runSignals: () =>
      guarded("Run signals", async () => {
        const { run, note } = await api.runSignals(repoId());
        showToast({
          title: `Signals: ${run.evaluated} evaluated · ${run.cached} cached`,
          description: `${usd(run.costUsd)} · ${run.modelId}${run.failed ? ` · ${run.failed} failed` : ""}${note ? ` — ${note}` : ""}`,
          variant: run.failed ? "warning" : "success",
        });
      }),
    logActions: () =>
      guarded("Log review actions", async () => {
        const { logged } = await api.logActions(repoId(), mode());
        showToast({
          title: `Logged ${logged.length} review action${logged.length === 1 ? "" : "s"}`,
          description: "Approval authority is stubbed — nothing was posted to GitHub.",
          variant: "info",
        });
      }),
    calibrate: () =>
      guarded("Calibration", async () => {
        const { artifact } = await api.calibrate(repoId());
        showToast({
          title: `Calibration ${artifact.hash}`,
          description: `Multiplier gate ${artifact.gate.passed ? "passed" : "failed"} · AUROC ${artifact.metrics.fitted.auroc ?? "—"}`,
          variant: artifact.gate.passed ? "success" : "warning",
        });
      }),
  };

  return <RepoContext.Provider value={value}>{props.children}</RepoContext.Provider>;
};

export function useRepo(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepo outside RepoProvider");
  return ctx;
}
