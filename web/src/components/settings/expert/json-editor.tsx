import { createMemo, createSignal, For, Show } from "solid-js";
import { Download, Upload } from "lucide-solid";
import { configFileSchema, flattenConfig, mergeConfig, type ConfigFile } from "@pullup/core/config-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SourceBadge } from "../field-row";
import { safeLatest } from "@/lib/state";
import { useSettings } from "../settings-context";

function short(v: unknown): string {
  const t = JSON.stringify(v);
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/** Every effective leaf with where it came from. */
export function EffectiveView() {
  const s = useSettings();
  const [filter, setFilter] = createSignal("");
  const rows = createMemo(() =>
    Object.entries(flattenConfig(s.effective() as Record<string, unknown>)).filter(([k]) =>
      k.toLowerCase().includes(filter().toLowerCase()),
    ),
  );
  return (
    <div class="space-y-2">
      <Input value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} placeholder="Filter paths…" class="h-8 max-w-sm" aria-label="Filter config paths" />
      <div class="max-h-[460px] overflow-auto rounded-md border border-border" data-testid="effective-view">
        <table class="w-full text-xs">
          <tbody>
            <For each={rows()}>
              {([k, v]) => (
                <tr class="border-b border-border/50 last:border-0">
                  <td class="num px-3 py-1.5 text-muted-foreground">{k}</td>
                  <td class="num px-3 py-1.5">{short(v)}</td>
                  <td class="px-3 py-1.5 text-right">
                    <SourceBadge path={k} />
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The repo layer as JSON: edit, validate live, apply to the draft; import/export. */
export function JsonEditor() {
  const s = useSettings();
  const [text, setText] = createSignal<string | null>(null);
  const [importError, setImportError] = createSignal<string | null>(null);
  const current = () => text() ?? JSON.stringify(s.draft(), null, 2);
  const parsed = createMemo(() => {
    try {
      const raw = JSON.parse(current()) as unknown;
      const r = configFileSchema.safeParse(raw);
      return r.success
        ? { ok: true as const, value: r.data, issues: [] as string[] }
        : { ok: false as const, value: null, issues: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
    } catch (err) {
      return { ok: false as const, value: null, issues: [`Not valid JSON: ${(err as Error).message}`] };
    }
  });
  const apply = () => {
    const p = parsed();
    if (p.ok) {
      s.replaceDraft(p.value);
      setText(null);
    }
  };
  const exportFile = () => {
    // The file layer + this repo's draft, as one pullup.config.json.
    const merged = mergeConfig<ConfigFile>(safeLatest(s.server)?.file ?? {}, s.draft());
    const blob = new Blob([JSON.stringify(merged, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pullup.config.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const r = configFileSchema.safeParse(raw);
      if (!r.success) {
        setImportError(`Import rejected: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        return;
      }
      s.replaceDraft(r.data);
      setText(null);
      setImportError(null);
    } catch (err) {
      setImportError(`Import rejected: ${(err as Error).message}`);
    }
  };
  let fileInput!: HTMLInputElement;
  return (
    <div class="space-y-2">
      <Textarea
        value={current()}
        onInput={(e) => setText(e.currentTarget.value)}
        rows={16}
        showCount={false}
        class="num text-xs"
        aria-label="Repo settings JSON"
        spellcheck={false}
      />
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={apply} disabled={!parsed().ok || text() === null}>
          Apply to draft
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setText(null)} disabled={text() === null}>
          Revert text
        </Button>
        <span class="ml-auto" />
        <Button variant="secondary" size="sm" onClick={exportFile}>
          <Download /> Export pullup.config.json
        </Button>
        <Button variant="secondary" size="sm" onClick={() => fileInput.click()}>
          <Upload /> Import…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          class="hidden"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void importFile(f);
            e.currentTarget.value = "";
          }}
        />
      </div>
      <Show when={!parsed().ok}>
        <ul class="space-y-0.5 text-xs text-destructive" role="alert" data-testid="json-issues">
          <For each={parsed().issues}>{(i) => <li class="num">{i}</li>}</For>
        </ul>
      </Show>
      <Show when={importError()}>
        <p class="text-xs text-destructive" role="alert">
          {importError()}
        </p>
      </Show>
    </div>
  );
}
