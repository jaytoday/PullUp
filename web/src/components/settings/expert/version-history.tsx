import { createResource, createSignal, For, Show } from "solid-js";
import { History, RotateCcw } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast";
import { ApiError, api, type VersionEntry } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { safeLatest } from "@/lib/state";
import { ChangeList } from "../change-list";
import { useSettings } from "../settings-context";

function VersionRow(props: { v: VersionEntry; latest: number | null }) {
  const s = useSettings();
  const [open, setOpen] = createSignal(false);
  const [confirm, setConfirm] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const restore = async () => {
    setBusy(true);
    try {
      await api.restoreConfig(s.repoId(), props.v.version, {
        baseVersion: props.latest,
        ...(confirm() !== null ? { confirmLoosen: confirm()! } : {}),
      });
      showToast({ title: `Restored v${props.v.version}`, description: "Saved as a new version.", variant: "success" });
      setConfirm(null);
      s.afterSave();
    } catch (err) {
      if (err instanceof ApiError && err.details.needsConfirm) setConfirm("");
      else showToast({ title: "Restore failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li class="space-y-2 border-b border-border/60 py-3 last:border-0" data-testid="config-version-row" data-version={props.v.version}>
      <div class="flex flex-wrap items-center gap-2">
        <span class="num text-sm font-medium">v{props.v.version}</span>
        <Show when={props.v.version === props.latest}>
          <span class="rounded border border-primary/40 px-1 text-[10px] text-primary">current</span>
        </Show>
        <Show when={props.v.loosened.length > 0}>
          <span class="rounded border border-band-escalate/40 px-1 text-[10px] text-band-escalate">loosened {props.v.loosened.length}</span>
        </Show>
        <Show when={props.v.restoredFrom}>{(r) => <span class="text-[11px] text-muted-foreground">restored from v{r()}</span>}</Show>
        <span class="text-xs text-muted-foreground">{props.v.note || "no note"}</span>
        <span class="num ml-auto text-[11px] text-muted-foreground">
          {dateTime(props.v.createdAt)} · {props.v.author} · {props.v.hash.slice(0, 10)}
        </span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open())}>
          {open() ? "Hide" : "Show"} {props.v.changes.length} change{props.v.changes.length === 1 ? "" : "s"}
        </Button>
        <Show when={props.v.version !== props.latest}>
          <Button variant="secondary" size="sm" onClick={() => void restore()} disabled={busy() || s.dirty()} title={s.dirty() ? "Save or discard your draft first" : undefined}>
            <RotateCcw /> Restore this version
          </Button>
        </Show>
      </div>
      <Show when={confirm() !== null}>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="text-band-escalate">Restoring loosens the gate — type <span class="num">{s.repoId()}</span> to confirm:</span>
          <Input class="num h-8 max-w-56" value={confirm() ?? ""} onInput={(e) => setConfirm(e.currentTarget.value)} aria-label="Confirm repo name" />
          <Button size="sm" onClick={() => void restore()} disabled={confirm() !== s.repoId() || busy()}>
            Confirm restore
          </Button>
        </div>
      </Show>
      <Show when={open()}>
        <ChangeList changes={props.v.changes} />
      </Show>
    </li>
  );
}

export function VersionHistory() {
  const s = useSettings();
  const [versions] = createResource(
    () => ({ id: s.repoId(), v: safeLatest(s.server)?.version ?? null }),
    (k) => api.configVersions(k.id),
  );
  const latest = () => safeLatest(s.server)?.version ?? null;
  return (
    <Show
      when={(safeLatest(versions) ?? []).length > 0}
      fallback={
        <p class="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <History class="size-4" /> No saved versions yet.
        </p>
      }
    >
      <ol data-testid="version-history">
        <For each={safeLatest(versions)}>{(v) => <VersionRow v={v} latest={latest()} />}</For>
      </ol>
    </Show>
  );
}
