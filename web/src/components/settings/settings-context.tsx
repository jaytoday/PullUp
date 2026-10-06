// Draft state for the repo settings page. The draft is the *repo layer* (a
// partial config); what the page shows is defaults < file < draft, validated
// with the same schema the server enforces (`@pullup/core/config-schema`).
// Unsaved drafts survive a reload via localStorage, keyed by repo + base version.

import {
  createContext,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  useContext,
  type Accessor,
  type ParentComponent,
  type Resource,
} from "solid-js";
import {
  MODE_AUTHORITY,
  PRESETS,
  configFileSchema,
  diffConfig,
  effectiveConfigFile,
  flattenConfig,
  getPath,
  loosening,
  mergeConfig,
  namedModeOf,
  setPath,
  unsetPath,
  type ActionAuthority,
  type AuthorityAction,
  type AuthorityLevel,
  type ConfigChange,
  type ConfigFile,
  type NamedMode,
  type PresetId,
} from "@pullup/core/config-schema";
import { showToast } from "@/components/ui/toast";
import { useRepo } from "@/components/layout/repo-context";
import { ApiError, api, type ConfigPreview, type Issue, type RepoConfigResponse } from "@/lib/api";
import { safeLatest } from "@/lib/state";

export type FieldSource = "default" | "file" | "repo" | "draft";

interface SettingsContextValue {
  repoId: Accessor<string>;
  server: Resource<RepoConfigResponse>;
  /** The repo layer being edited. */
  draft: Accessor<ConfigFile>;
  /** Defaults < file < draft. */
  effective: Accessor<ConfigFile>;
  get: <T = unknown>(path: string) => T;
  sourceOf: (path: string) => FieldSource;
  set: (path: string, value: unknown) => void;
  /** Drop the repo-layer value so the file/default applies again. */
  reset: (path: string) => void;
  replaceDraft: (next: ConfigFile) => void;
  changes: Accessor<ConfigChange[]>;
  loosened: Accessor<ConfigChange[]>;
  dirty: Accessor<boolean>;
  issues: Accessor<Issue[]>;
  issueFor: (path: string) => string | null;
  mode: Accessor<NamedMode | "custom">;
  authority: Accessor<ActionAuthority>;
  setMode: (m: NamedMode) => void;
  setAuthority: (action: AuthorityAction, level: AuthorityLevel) => void;
  /** Approve · Act unlocks only with a passing fast-path gate *and* live delivery. */
  approvalUnlocked: Accessor<boolean>;
  /** Why it is locked (server's reason), or null. */
  approvalLockedReason: Accessor<string | null>;
  preset: Accessor<{ id: PresetId | null; drift: number }>;
  applyPreset: (id: PresetId) => void;
  discard: () => void;
  /** After a save: refetch the server state and drop the stored draft. */
  afterSave: () => void;
  preview: Accessor<ConfigPreview | null>;
  previewLoading: Accessor<boolean>;
  previewError: Accessor<string | null>;
  runPreview: () => Promise<void>;
  previewOpen: Accessor<boolean>;
  setPreviewOpen: (o: boolean) => void;
  saveOpen: Accessor<boolean>;
  setSaveOpen: (o: boolean) => void;
}

const SettingsContext = createContext<SettingsContextValue>();

const storageKey = (repoId: string) => `pullup:settings-draft:${repoId}`;

interface StoredDraft {
  readonly baseVersion: number | null;
  readonly draft: ConfigFile;
}

function readStored(repoId: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(repoId));
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    return null;
  }
}

function writeStored(repoId: string, value: StoredDraft | null): void {
  try {
    if (value) localStorage.setItem(storageKey(repoId), JSON.stringify(value));
    else localStorage.removeItem(storageKey(repoId));
  } catch {
    // Storage unavailable (private mode): drafts just don't survive reloads.
  }
}

export const SettingsProvider: ParentComponent = (props) => {
  const repo = useRepo();
  const [server, { refetch }] = createResource(() => repo.repoId(), (id) => api.repoConfig(id));
  const [draft, setDraft] = createSignal<ConfigFile>({});
  const [preview, setPreview] = createSignal<ConfigPreview | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [saveOpen, setSaveOpen] = createSignal(false);

  const base = () => safeLatest(server);

  // Load (or restore) the draft whenever the server state changes.
  createEffect(
    on(
      () => base(),
      (s) => {
        if (!s) return;
        const stored = readStored(s.repoId);
        if (stored && stored.baseVersion === s.version) {
          const restored = diffConfig(effectiveConfigFile(s.file, s.repo), effectiveConfigFile(s.file, stored.draft));
          if (restored.length > 0) {
            setDraft(stored.draft);
            showToast({ title: "Restored unsaved changes", description: `${restored.length} change(s) from your last visit.`, variant: "default" });
            return;
          }
        }
        if (stored) writeStored(s.repoId, null);
        setDraft(s.repo);
      },
    ),
  );

  const effective = createMemo(() => effectiveConfigFile(base()?.file ?? {}, draft()));
  const savedEffective = createMemo(() => base()?.effective ?? effectiveConfigFile({}, null));
  const changes = createMemo(() => (base() ? diffConfig(savedEffective(), effective()) : []));
  const loosenedChanges = createMemo(() => loosening(changes()));
  const dirty = () => changes().length > 0;

  // Persist unsaved drafts; clear once back in sync.
  createEffect(() => {
    const s = base();
    if (!s) return;
    writeStored(s.repoId, dirty() ? { baseVersion: s.version, draft: draft() } : null);
  });

  // Any edit invalidates the last preview.
  createEffect(on(draft, () => setPreview(null), { defer: true }));

  const issues = createMemo<Issue[]>(() => {
    const r = configFileSchema.safeParse(draft());
    return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  });

  const sourceOf = (path: string): FieldSource => {
    const inDraft = getPath(draft(), path);
    const inSaved = getPath(base()?.repo ?? {}, path);
    if (inDraft !== undefined || inSaved !== undefined) {
      // A pending edit (or a pending reset back to the file/default).
      return JSON.stringify(inDraft) === JSON.stringify(inSaved) ? "repo" : "draft";
    }
    const sources = base()?.sources ?? {};
    if (sources[path] === "file") return "file";
    // A block (e.g. a list or record) is "file" if any leaf under it is.
    return Object.entries(sources).some(([k, v]) => k.startsWith(`${path}.`) && v === "file") ? "file" : "default";
  };

  const set = (path: string, value: unknown) => setDraft((d) => setPath(d, path, value));
  const reset = (path: string) => setDraft((d) => unsetPath(d, path));

  const authority = createMemo(() => effective().actions as ActionAuthority);
  const mode = createMemo(() => namedModeOf(authority()));

  const preset = createMemo(() => {
    const id = (effective().preset ?? null) as PresetId | null;
    if (!id) return { id: null, drift: 0 };
    const spec = PRESETS.find((p) => p.id === id)!;
    const want = flattenConfig(spec.values as Record<string, unknown>);
    const drift = Object.entries(want).filter(([k, v]) => JSON.stringify(getPath(effective(), k)) !== JSON.stringify(v)).length;
    return { id, drift };
  });

  const value: SettingsContextValue = {
    repoId: repo.repoId,
    server,
    draft,
    effective,
    get: <T,>(path: string) => getPath(effective(), path) as T,
    sourceOf,
    set,
    reset,
    replaceDraft: setDraft,
    changes,
    loosened: loosenedChanges,
    dirty,
    issues,
    issueFor: (path) => issues().find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message ?? null,
    mode,
    authority,
    setMode: (m) => set("actions", { ...MODE_AUTHORITY[m] }),
    setAuthority: (action, level) => set(`actions.${action}`, level),
    approvalUnlocked: () => {
      const a = base()?.approval;
      return Boolean(a && (a.unlocked ?? (a.fastPathGatePassed && a.liveActuator)));
    },
    approvalLockedReason: () => base()?.approval.lockedReason ?? null,
    preset,
    applyPreset: (id) => {
      const spec = PRESETS.find((p) => p.id === id)!;
      setDraft((d) => mergeConfig<ConfigFile>(d, spec.values, { preset: id }));
    },
    discard: () => {
      setDraft(base()?.repo ?? {});
      writeStored(repo.repoId(), null);
    },
    afterSave: () => {
      writeStored(repo.repoId(), null);
      setPreview(null);
      void refetch();
      repo.refresh();
    },
    preview,
    previewLoading,
    previewError,
    runPreview: async () => {
      if (issues().length > 0) {
        setPreviewError("Fix the highlighted fields first.");
        return;
      }
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        setPreview(await api.previewConfig(repo.repoId(), draft()));
      } catch (err) {
        setPreviewError(err instanceof ApiError ? err.message : String(err));
      } finally {
        setPreviewLoading(false);
      }
    },
    previewOpen,
    setPreviewOpen,
    saveOpen,
    setSaveOpen,
  };

  return <SettingsContext.Provider value={value}>{props.children}</SettingsContext.Provider>;
};

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}
