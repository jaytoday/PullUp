"use client";

import type { FieldSpec } from "@pullup/engine";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getPath, listText, mapText, parseList, parseMap, type Section, setPath } from "./values";

/**
 * An extension's settings form, generated from its field list: one control per
 * field, by kind. A field that can loosen PullUp carries a "loosens" mark.
 */
export function ExtensionForm({ fields, defaults, section, onChange }: { fields: FieldSpec[]; defaults: Section; section: Section; onChange: (next: Section) => void }) {
  const valueOf = (f: FieldSpec) => getPath(section, f.key) ?? getPath(defaults, f.key);
  const set = (f: FieldSpec, value: unknown) => onChange(setPath(section, f.key, value));
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const value = valueOf(f);
        const label = (
          <span className="flex items-center gap-2">
            {f.label}
            {f.loosens ? (
              <Badge color="warning" variant="subtle">
                loosens
              </Badge>
            ) : null}
          </span>
        );
        if (f.kind === "boolean") {
          return (
            <label key={f.key} className="flex items-start justify-between gap-4 text-sm text-body">
              <span className="space-y-0.5">
                <span className="block text-foreground">{label}</span>
                <span className="block text-xs text-muted-foreground">{f.help}</span>
              </span>
              <Switch checked={value === true} onCheckedChange={(v) => set(f, v)} aria-label={f.label} />
            </label>
          );
        }
        if (f.kind === "list" && f.options) {
          const chosen = new Set(Array.isArray(value) ? (value as string[]) : []);
          return (
            <FormField key={f.key} label={label} description={f.help}>
              <div className="flex flex-wrap gap-3">
                {f.options.map((o) => (
                  <label key={o} className="flex items-center gap-2 text-sm text-body">
                    <Switch
                      checked={chosen.has(o)}
                      onCheckedChange={(v) => set(f, v ? [...chosen, o] : [...chosen].filter((x) => x !== o))}
                      aria-label={`${f.label}: ${o}`}
                    />
                    {o}
                  </label>
                ))}
              </div>
            </FormField>
          );
        }
        if (f.kind === "choice" && f.options) {
          return (
            <FormField key={f.key} label={label} description={f.help}>
              <Select value={String(value ?? "")} onValueChange={(v) => set(f, v)}>
                <SelectTrigger className="w-full" aria-label={f.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {f.options.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          );
        }
        return (
          <FormField key={f.key} label={label} description={f.help}>
            {f.kind === "number" ? (
              <Input type="number" value={Number(value ?? 0)} onChange={(e) => set(f, Number(e.target.value))} aria-label={f.label} />
            ) : f.kind === "list" ? (
              <Input defaultValue={listText(value)} onBlur={(e) => set(f, parseList(e.target.value))} placeholder="one, two" aria-label={f.label} />
            ) : f.kind === "map" ? (
              <Input defaultValue={mapText(value)} onBlur={(e) => set(f, parseMap(e.target.value))} placeholder="@octocat = octocat@example.com" aria-label={f.label} />
            ) : (
              <Input value={String(value ?? "")} onChange={(e) => set(f, e.target.value)} aria-label={f.label} />
            )}
          </FormField>
        );
      })}
    </div>
  );
}
