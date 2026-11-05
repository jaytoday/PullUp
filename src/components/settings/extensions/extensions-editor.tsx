"use client";

import type { FieldSpec } from "@pullup/engine";
import { configSchema, loosenings } from "@pullup/engine/config";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { discardExtensionsDraft, saveExtensionsDraft } from "@/app/(app)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ExtensionForm } from "./extension-form";
import type { Section } from "./values";

type Mode = "off" | "shadow" | "active";
const MODES: { id: Mode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "shadow", label: "Shadow" },
  { id: "active", label: "Active" },
];

export interface ExtensionInfo {
  id: string;
  version: string;
  title: string;
  summary: string;
  defaultMode: string;
  fields: FieldSpec[];
  defaults: Section;
}

type ConfigFile = { extensions: Record<string, Section> } & Record<string, unknown>;

/**
 * Settings → Extensions for one repository: every bundled extension with a
 * mode (Off · Shadow · Active) and a generated settings form. Changes are a
 * draft of `.pullup/config.json` that the owner commits to the default branch
 * (PullUp never writes to the repository). A change that loosens PullUp needs
 * "loosen" typed before it can be saved. Nothing here is animated.
 */
export function ExtensionsEditor({ repo, extensions, committed, draft }: { repo: string; extensions: ExtensionInfo[]; committed: ConfigFile; draft: ConfigFile | null }) {
  const start = draft ?? committed;
  const [sections, setSections] = useState<Record<string, Section>>(start.extensions);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [pending, run] = useTransition();

  const committedLoose = useMemo(() => {
    const parsed = configSchema.safeParse(committed);
    return new Set(parsed.success ? loosenings(parsed.data) : []);
  }, [committed]);
  const file = { ...start, extensions: sections };
  const parsed = configSchema.safeParse(file);
  const loose = parsed.success ? loosenings(parsed.data).filter((l) => !committedLoose.has(l)) : [];
  const changed = JSON.stringify(sections) !== JSON.stringify(start.extensions);
  const uncommitted = JSON.stringify(file.extensions) !== JSON.stringify(committed.extensions);
  const canSave = changed && parsed.success && (!loose.length || confirm.trim().toLowerCase() === "loosen");

  const modeOf = (e: ExtensionInfo): Mode => (sections[e.id]?.mode as Mode | undefined) ?? (e.defaultMode === "active" ? "active" : "off");
  const setSection = (id: string, next: Section) => setSections({ ...sections, [id]: next });
  const current = extensions.find((e) => e.id === editing);

  const save = () =>
    run(async () => {
      const result = await saveExtensionsDraft(repo, sections, confirm);
      if (result.ok) {
        setConfirm("");
        toast.success("Draft saved. Commit the file to the default branch for it to take effect.");
      } else toast.error(result.error);
    });
  const discard = () =>
    run(async () => {
      await discardExtensionsDraft(repo);
      setSections(committed.extensions);
      setConfirm("");
      toast.success("Draft discarded");
    });

  return (
    <div className="space-y-3" data-testid={`extensions-${repo}`}>
      <ul className="divide-y overflow-hidden rounded-md bg-background ring ring-border">
        {extensions.map((e) => {
          const mode = modeOf(e);
          return (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5" data-testid={`extension-${e.id}`}>
              <div className="min-w-0 flex-1 basis-64">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {e.title}
                  <span className="font-mono text-xs font-normal text-muted-foreground">{e.id}</span>
                </p>
                <p className="text-xs text-muted-foreground">{e.summary}</p>
              </div>
              <div className="flex items-center gap-2">
                <div role="radiogroup" aria-label={`${e.title} mode`} className="flex rounded-md ring ring-border">
                  {MODES.map((m) => (
                    <Button
                      key={m.id}
                      role="radio"
                      aria-checked={mode === m.id}
                      size="xs"
                      color={mode === m.id ? (m.id === "active" ? "primary" : "neutral") : "neutral"}
                      variant={mode === m.id ? (m.id === "active" ? "solid" : "soft") : "ghost"}
                      onClick={() => setSection(e.id, { ...(sections[e.id] ?? {}), mode: m.id })}
                    >
                      {m.label}
                    </Button>
                  ))}
                </div>
                <Button size="xs" color="neutral" variant="outline" icon="i-lucide-settings-2" disabled={!e.fields.length} onClick={() => setEditing(e.id)} aria-label={`${e.title} settings`}>
                  Settings
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {!parsed.success ? <p className="text-sm text-error">{parsed.error.issues[0]?.message}</p> : null}
      {loose.length ? (
        <div className="space-y-2 rounded-md bg-warning/10 p-3 text-sm" data-testid="extension-loosenings">
          <p className="font-medium text-foreground">These changes loosen PullUp:</p>
          <ul className="list-disc space-y-1 ps-5 text-body">
            {loose.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <FormField label='Type "loosen" to keep them'>
            <Input value={confirm} onChange={(ev) => setConfirm(ev.target.value)} autoComplete="off" />
          </FormField>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" color="primary" disabled={!canSave} loading={pending} onClick={save}>
          Save draft
        </Button>
        {draft ? (
          <Button size="sm" color="neutral" variant="ghost" loading={pending} onClick={discard}>
            Discard draft
          </Button>
        ) : null}
        {uncommitted && !changed ? (
          <Badge color="warning" variant="subtle" data-testid="draft-not-committed">
            Draft saved, not committed yet
          </Badge>
        ) : null}
      </div>

      {uncommitted ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">The file to commit as .pullup/config.json</summary>
          <div className="mt-2 space-y-2">
            <pre className="max-h-80 overflow-auto rounded bg-elevated p-3 font-mono text-body" data-testid="extensions-file">
              {JSON.stringify(file, null, 2)}
            </pre>
            <Button
              size="xs"
              color="neutral"
              variant="outline"
              icon="i-lucide-copy"
              onClick={() => {
                void navigator.clipboard?.writeText(JSON.stringify(file, null, 2));
                toast.success("Copied .pullup/config.json");
              }}
            >
              Copy the file
            </Button>
          </div>
        </details>
      ) : null}

      <Dialog open={current !== undefined} onOpenChange={(open) => !open && setEditing(null)}>
        {current ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{current.title} settings</DialogTitle>
              <DialogDescription>{current.summary}</DialogDescription>
            </DialogHeader>
            <ExtensionForm fields={current.fields} defaults={current.defaults} section={sections[current.id] ?? {}} onChange={(next) => setSection(current.id, next)} />
            <DialogFooter>
              <Button color="neutral" variant="outline" onClick={() => setEditing(null)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
